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

// Proposes a card for each unmapped account whose institution matches the card's issuer and whose
// last four digits equal the card's. Ambiguous matches propose nothing. The owner confirms each one.
const ISSUERS: [RegExp, RegExp][] = [
  [/american express|amex/i, /american express/i],
  [/chase|jpmorgan/i, /chase/i],
  [/discover/i, /discover/i],
];
export async function proposeMappings(tx: Tx) {
  const { rows: accounts } = await tx.query(
    "select id, institution, name, mask from public.accounts where mapping_status='unmapped' and mask is not null",
  );
  const { rows: cards } = await tx.query(
    "select id, issuer, last4 from public.cards where last4 is not null",
  );
  for (const a of accounts) {
    const issuer = ISSUERS.find(([inst]) =>
      inst.test(`${a.institution} ${a.name}`),
    );
    const matches = cards.filter(
      (c) => c.last4 === a.mask && (!issuer || issuer[1].test(c.issuer)),
    );
    if (issuer && matches.length === 1)
      await tx.query(
        "update public.accounts set proposed_card_id=$2, mapping_status='proposed' where id=$1",
        [a.id, matches[0].id],
      );
  }
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
  await proposeMappings(tx);
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
