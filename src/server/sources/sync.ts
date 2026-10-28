import "server-only";
import { withOwner, type Tx } from "../db";
import { runMatchersSafely } from "../matchers";
import { decryptSecret, encryptSecret, reference } from "../crypto";
import { localDate, shiftDays } from "@/lib/domain";
import { simplefinAdapter } from "./simplefin";
import { plaidAdapter } from "./plaid";
import type { SourceAdapter, SourceBatch, SyncWindow } from "./types";

export type Adapters = Record<"simplefin" | "plaid", SourceAdapter>;
export const defaultAdapters = (): Adapters => ({
  simplefin: simplefinAdapter(),
  plaid: plaidAdapter(),
});
const TZ = "America/New_York";
// SimpleFIN Bridge refreshes institutions about once a day, so each sync overlaps the last one by
// two weeks to catch pending→posted changes and late credits.
// SimpleFIN Bridge limits each /accounts request to 90 days and expects at most about 24 requests a
// day, disabling access tokens that exceed it (https://beta-bridge.simplefin.org/info/developers,
// read 2026-10-28). Windows are capped at 90 days and manual syncs wait out a cooldown.
const OVERLAP_DAYS = 14,
  MAX_WINDOW_DAYS = 90,
  MANUAL_COOLDOWN_MS = 30 * 60 * 1000;
export const secretLabel = (connectionId: string) =>
  `source_connection:${connectionId}`;

export class SyncCooldownError extends Error {}

export function syncWindow(
  lastSuccessAt: string | null,
  now = new Date(),
): SyncWindow {
  const today = localDate(now, TZ);
  const endExclusive = shiftDays(today, 1),
    earliest = shiftDays(endExclusive, -MAX_WINDOW_DAYS);
  const start = lastSuccessAt
    ? shiftDays(localDate(new Date(lastSuccessAt), TZ), -OVERLAP_DAYS)
    : earliest;
  return { start: start < earliest ? earliest : start, endExclusive };
}

// Each synced card account becomes one of the owner's cards (D41). An account whose last four
// digits match exactly one card of the same issuer is linked to it. Otherwise the product named in
// the account (for example "Sapphire Reserve") fills in that product's starter card, or a new card
// is created from what the issuer reported. Links are confirmed on the owner's standing
// instruction; the owner can unlink any of them, and an unlinked account is never relinked here.
const ISSUERS: { institution: RegExp; card: RegExp; name: string }[] = [
  {
    institution: /american express|amex/i,
    card: /american express/i,
    name: "American Express",
  },
  { institution: /chase|jpmorgan/i, card: /chase/i, name: "Chase" },
  { institution: /discover/i, card: /discover/i, name: "Discover" },
  { institution: /citi/i, card: /citi/i, name: "Citi" },
  { institution: /apple|goldman/i, card: /apple/i, name: "Apple" },
  { institution: /capital one/i, card: /capital one/i, name: "Capital One" },
];
const PRODUCTS: {
  key: string;
  issuer: string;
  pattern: RegExp;
  display_name: string;
  product_name: string;
}[] = [
  {
    key: "amex-gold",
    issuer: "American Express",
    pattern: /gold/i,
    display_name: "Gold",
    product_name: "American Express Gold",
  },
  {
    key: "chase-sapphire-reserve",
    issuer: "Chase",
    pattern: /sapphire\s*reserve/i,
    display_name: "Sapphire Reserve",
    product_name: "Chase Sapphire Reserve",
  },
  {
    key: "chase-freedom-unlimited",
    issuer: "Chase",
    pattern: /freedom\s*unlimited/i,
    display_name: "Freedom Unlimited",
    product_name: "Chase Freedom Unlimited",
  },
  {
    key: "chase-freedom-flex",
    issuer: "Chase",
    pattern: /freedom\s*flex/i,
    display_name: "Freedom Flex",
    product_name: "Chase Freedom Flex",
  },
  {
    key: "chase-prime-visa",
    issuer: "Chase",
    pattern: /prime|amazon/i,
    display_name: "Prime Visa",
    product_name: "Chase Prime Visa",
  },
  {
    key: "chase-ink-business-cash",
    issuer: "Chase",
    pattern: /ink.*cash/i,
    display_name: "Ink Business Cash",
    product_name: "Chase Ink Business Cash",
  },
  {
    key: "chase-ink-business-preferred",
    issuer: "Chase",
    pattern: /ink.*preferred/i,
    display_name: "Ink Business Preferred",
    product_name: "Chase Ink Business Preferred",
  },
  {
    key: "discover-it",
    issuer: "Discover",
    pattern: /discover/i,
    display_name: "Discover it",
    product_name: "Discover it",
  },
  {
    key: "citi-costco-anywhere",
    issuer: "Citi",
    pattern: /costco/i,
    display_name: "Costco Anywhere Visa",
    product_name: "Citi Costco Anywhere Visa",
  },
  {
    key: "citi-strata",
    issuer: "Citi",
    pattern: /strata/i,
    display_name: "Strata",
    product_name: "Citi Strata",
  },
  {
    key: "citi-double-cash",
    issuer: "Citi",
    pattern: /double\s*cash/i,
    display_name: "Double Cash",
    product_name: "Citi Double Cash",
  },
  {
    key: "apple-card",
    issuer: "Apple",
    pattern: /apple/i,
    display_name: "Apple Card",
    product_name: "Apple Card",
  },
];
const MASK_SUFFIX = /\s*(?:\(|-|\s)?(?:\.\.\.|x+|\*+)?\d{4}\)?\s*$/i;

export function identifyAccount(a: { institution: string; name: string }) {
  const text = `${a.institution} ${a.name}`;
  const issuer = ISSUERS.find((i) => i.institution.test(text));
  const product = issuer
    ? PRODUCTS.find((p) => p.issuer === issuer.name && p.pattern.test(a.name))
    : undefined;
  return { issuer, product };
}

export async function linkAccounts(tx: Tx) {
  const { rows: accounts } = await tx.query(
    `select id, institution, name, mask, kind from public.accounts
     where mapping_status='unmapped' and source in ('simplefin','plaid') order by institution, name, id`,
  );
  for (const a of accounts) {
    const { issuer, product } = identifyAccount(a);
    // Checking, savings and other accounts never become cards.
    if (a.kind !== "credit" && !product) continue;
    // Without last four digits, only a named product with exactly one possible card is linked.
    if (!a.mask && !product) continue;
    await tx.query("savepoint link_account");
    try {
      const cardId = await cardFor(tx, a, issuer, product);
      if (cardId) {
        await tx.query(
          `update public.accounts set card_id=$2, proposed_card_id=$2, mapping_status='confirmed', mapping_confirmed_at=now()
           where id=$1`,
          [a.id, cardId],
        );
        // The issuer's own account confirms the card, unless the owner marked it closed.
        await tx.query(
          `update public.cards set status='active', identity_verified_at=coalesce(identity_verified_at, now())
           where id=$1 and status<>'closed'`,
          [cardId],
        );
      }
      await tx.query("release savepoint link_account");
    } catch (e) {
      // A card that cannot be created leaves the account for the owner to link; the sync goes on.
      await tx.query("rollback to savepoint link_account");
      console.error(
        "PerkKeep account link failed",
        e instanceof Error ? e.name : "unknown",
      );
    }
  }
}

async function cardFor(
  tx: Tx,
  a: { institution: string; name: string; mask: string | null },
  issuer: (typeof ISSUERS)[number] | undefined,
  product: (typeof PRODUCTS)[number] | undefined,
): Promise<string | undefined> {
  const { rows: cards } = await tx.query(
    "select id, issuer, last4, catalog_key from public.cards",
  );
  if (a.mask) {
    const sameDigits = cards.filter(
      (c) => c.last4 === a.mask && (!issuer || issuer.card.test(c.issuer)),
    );
    if (sameDigits.length > 1) return undefined;
    if (sameDigits.length === 1) return sameDigits[0].id;
  } else {
    const same = cards.filter((c) => c.catalog_key === product!.key);
    if (same.length === 1) return same[0].id;
    if (same.length > 1) return undefined;
  }
  const starter =
    product && a.mask
      ? cards.find((c) => c.catalog_key === product.key && !c.last4)
      : undefined;
  if (starter) {
    await tx.query(
      `update public.cards set last4=$2, status='active', identity_verified_at=coalesce(identity_verified_at, now())
       where id=$1`,
      [starter.id, a.mask],
    );
    return starter.id;
  }
  const taken = product && cards.some((c) => c.catalog_key === product.key);
  const name = a.name.replace(MASK_SUFFIX, "").trim().slice(0, 100) || "Card";
  const { rows } = await tx.query(
    `insert into public.cards(issuer, display_name, product_name, last4, catalog_key, status, identity_verified_at)
     values ($1,$2,$3,$4,$5,'active',now()) returning id`,
    [
      issuer?.name ?? (a.institution.slice(0, 100) || "Unknown issuer"),
      product?.display_name ?? name,
      product?.product_name ?? null,
      a.mask,
      product && !taken ? product.key : null,
    ],
  );
  return rows[0].id;
}

export async function storeBatch(
  tx: Tx,
  connection: { id: string | null; source: "simplefin" | "plaid" | "csv" },
  batch: SourceBatch,
  window: SyncWindow,
) {
  const accountIds = new Map<string, string>();
  for (const a of batch.accounts) {
    const { rows } = await tx.query(
      `insert into public.accounts(source,connection_id,external_ref,institution,name,mask,kind,currency)
       values($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict(owner_user_id,source,external_ref) do update set institution=excluded.institution,
         name=excluded.name, mask=coalesce(excluded.mask, accounts.mask), kind=excluded.kind,
         connection_id=coalesce(excluded.connection_id, accounts.connection_id)
       returning id`,
      [
        connection.source,
        connection.id,
        reference(`account:${connection.source}`, a.externalId),
        a.institution.slice(0, 200),
        a.name.slice(0, 200) || "Account",
        a.mask,
        a.kind,
        a.currency,
      ],
    );
    accountIds.set(a.externalId, rows[0].id);
    if (a.balanceCents !== null && a.balanceObservedAt)
      await tx.query(
        `insert into public.balance_snapshots(account_id,observed_at,balance_cents,available_cents,source)
         values($1,$2,$3,$4,$5) on conflict do nothing`,
        [
          rows[0].id,
          a.balanceObservedAt,
          a.balanceCents,
          a.availableCents,
          connection.source,
        ],
      );
  }
  let added = 0,
    revised = 0;
  for (const a of batch.accounts) {
    const accountId = accountIds.get(a.externalId)!;
    const refFor = (externalId: string) =>
      reference(`transaction:${connection.source}:${a.externalId}`, externalId);
    const rows = batch.transactions
      .filter((t) => t.accountExternalId === a.externalId)
      .map((t) => ({
        dedup_ref: refFor(t.externalId),
        transacted_on: t.transactedOn,
        posted_on: t.postedOn,
        amount_cents: t.amountCents,
        description: t.description,
        pending: t.pending,
        removed: t.removed === true,
      }));
    if (!batch.explicitRemovals && !a.error) {
      // A pending charge that vanished from a window the source fully returned was dropped or
      // replaced by a posted charge with a new id. Record that as a removal, never a deletion.
      const seen = new Set(rows.map((r) => r.dedup_ref));
      const { rows: pending } = await tx.query(
        `select t.dedup_ref from public.transactions t where t.account_id=$1 and t.pending and t.observation<>'removed'
           and t.transacted_on >= $2 and t.transacted_on < $3
           and not exists(select 1 from public.transactions l where l.supersedes_transaction_id=t.id)`,
        [accountId, window.start, window.endExclusive],
      );
      for (const p of pending)
        if (!seen.has(p.dedup_ref))
          rows.push({
            dedup_ref: p.dedup_ref,
            transacted_on: "",
            posted_on: null,
            amount_cents: 0,
            description: "",
            pending: false,
            removed: true,
          });
    }
    const { rows: result } = await tx.query(
      "select * from public.ingest_transactions($1,$2,$3)",
      [accountId, connection.source, JSON.stringify(rows)],
    );
    added += result[0].added;
    revised += result[0].revised;
    // Coverage reaches the source's own last refresh, not merely the day this sync ran.
    const refreshed = a.balanceObservedAt
      ? localDate(new Date(a.balanceObservedAt), TZ)
      : shiftDays(window.endExclusive, -1);
    const through =
      refreshed < window.endExclusive
        ? refreshed
        : shiftDays(window.endExclusive, -1);
    await tx.query("select public.record_account_sync($1,$2,$3,$4)", [
      accountId,
      window.start,
      through < window.start ? window.start : through,
      a.error,
    ]);
  }
  await linkAccounts(tx);
  return { accounts: accountIds.size, added, revised };
}

export async function syncConnection(
  ownerId: string,
  connectionId: string,
  trigger: "manual" | "scheduled" | "claim",
  adapters: Adapters = defaultAdapters(),
  now = new Date(),
) {
  const prepared = await withOwner(ownerId, async (tx) => {
    const { rows } = await tx.query(
      "select id, source, encrypted_secret, last_success_at, last_attempted_at from public.source_connections where id=$1 and status<>'revoked'",
      [connectionId],
    );
    if (!rows[0]) throw new Error("Connection not found.");
    const sinceLast = rows[0].last_attempted_at
      ? now.getTime() - Date.parse(rows[0].last_attempted_at)
      : Infinity;
    if (
      trigger === "manual" &&
      sinceLast >= 0 &&
      sinceLast < MANUAL_COOLDOWN_MS
    )
      throw new SyncCooldownError(
        `This connection synced ${Math.max(1, Math.round(sinceLast / 60000))} minutes ago. SimpleFIN allows only about 24 requests a day, so try again in ${Math.ceil((MANUAL_COOLDOWN_MS - sinceLast) / 60000)} minutes.`,
      );
    const window = syncWindow(rows[0].last_success_at, now);
    const run = await tx.query(
      `insert into public.source_syncs(connection_id,trigger,status,window_start,window_end)
       values($1,$2,'running',$3,$4) returning id`,
      [connectionId, trigger, window.start, shiftDays(window.endExclusive, -1)],
    );
    return {
      source: rows[0].source as "simplefin" | "plaid",
      secret: decryptSecret(
        rows[0].encrypted_secret,
        secretLabel(connectionId),
      ),
      window,
      runId: run.rows[0].id as string,
    };
  });
  let batch: SourceBatch;
  try {
    batch = await adapters[prepared.source].fetch(
      prepared.secret,
      prepared.window,
    );
  } catch (e) {
    const message = (e instanceof Error ? e.message : "Sync failed.").slice(
      0,
      500,
    );
    await withOwner(ownerId, async (tx) => {
      await tx.query(
        "update public.source_connections set status='error', last_attempted_at=now(), last_error=$2 where id=$1",
        [connectionId, message],
      );
      const { rows } = await tx.query(
        "select id from public.accounts where connection_id=$1",
        [connectionId],
      );
      for (const a of rows)
        await tx.query("select public.record_account_sync($1,$2,$3,$4)", [
          a.id,
          prepared.window.start,
          prepared.window.start,
          message,
        ]);
      await tx.query(
        "update public.source_syncs set status='failed', finished_at=now(), messages=$2 where id=$1",
        [prepared.runId, JSON.stringify([message])],
      );
    });
    return { status: "failed" as const, message };
  }
  return withOwner(ownerId, async (tx) => {
    const stored = await storeBatch(
      tx,
      { id: connectionId, source: prepared.source },
      batch,
      prepared.window,
    );
    const partial =
      batch.messages.length > 0 || batch.accounts.some((a) => a.error);
    await tx.query(
      `update public.source_connections set status='active', last_attempted_at=now(), last_success_at=now(), last_error=null,
         encrypted_secret=coalesce($2, encrypted_secret) where id=$1`,
      [
        connectionId,
        batch.nextSecret
          ? encryptSecret(batch.nextSecret, secretLabel(connectionId))
          : null,
      ],
    );
    const status = partial ? "partial" : "success";
    await tx.query(
      `update public.source_syncs set status=$2, finished_at=now(), accounts_seen=$3, transactions_added=$4, messages=$5 where id=$1`,
      [
        prepared.runId,
        status,
        stored.accounts,
        stored.added + stored.revised,
        JSON.stringify(batch.messages),
      ],
    );
    const matched = await runMatchersSafely(
      tx,
      trigger === "scheduled" ? "scheduled" : "manual",
    );
    return { status, ...stored, messages: batch.messages, matched };
  });
}
