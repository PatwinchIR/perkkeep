import "server-only";
import { randomUUID } from "node:crypto";
import type { Tx } from "../db";
import { sha256 } from "../crypto";
import { InputError } from "../ledger";
import { runMatchersSafely } from "../matchers";
import { shiftDays } from "@/lib/domain";
import {
  parseStatement,
  type CsvAccount,
  type CsvRow,
  type Format,
} from "./csv";
import { identifyAccount } from "./sync";

// Statement imports (D23, D53). A single-account file goes into the CSV account the owner chose.
// A multi-account export (Copilot Money) is split by the account named on each row: an account
// whose last four digits the owner already linked to a card lands in a CSV account for that card,
// and rows on or after the first day a synced account covers are left to the sync, so one credit
// is never counted twice. Every write stays inside the caller's owner transaction.
// CSV references are plain SHA-256 digests rather than keyed ones: the row they name is stored
// in clear beside them, and the owner-run import (scripts/neon-reconcile.ts) must produce the
// same references as Settings without the deployment's encryption key.
export type ImportInput = {
  file_name: string;
  file_text: string;
  format?: string;
  account_id?: string;
  new_account?: { institution: string; name: string; mask: string | null };
};
export type AccountImport = {
  account: string;
  digits: string | null;
  card: string | null;
  status: "imported" | "unchanged" | "skipped";
  reason: string | null;
  rows: number;
  added: number;
  unchanged: number;
  left_to_sync: number;
  coverage_start: string | null;
  coverage_end: string | null;
};
type Ingest = {
  accountId: string;
  format: Format;
  fileName: string;
  key: string; // the idempotency key: the file hash, or for one account of a multi-account file, its own hash
  rows: CsvRow[];
  coverageStart: string | null;
  coverageEnd: string | null;
};
type OwnedAccount = {
  id: string;
  source: string;
  external_ref: string;
  mask: string | null;
  card_id: string | null;
  mapping_status: string;
  earliest_synced_on: string | null;
  synced_through: string | null;
  last_error: string | null;
};
type Card = {
  id: string;
  issuer: string;
  display_name: string;
  last4: string | null;
  catalog_key: string | null;
  status: string;
  identity_verified_at: string | null;
};

const accountKey = (a: CsvAccount) => `${a.name}\u0000${a.mask ?? ""}`;

async function ingest(tx: Tx, i: Ingest) {
  // Identical rows within one file are distinct purchases, so each occurrence gets its own reference.
  const seen = new Map<string, number>();
  const rows = i.rows.map((r) => {
    const key = JSON.stringify([
      r.transactedOn,
      r.postedOn,
      r.amountCents,
      r.description,
    ]);
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return {
      dedup_ref: sha256(`transaction:csv:${i.accountId}\u0000${key}#${n}`),
      transacted_on: r.transactedOn,
      posted_on: r.postedOn,
      amount_cents: r.amountCents,
      description: r.description,
      pending: false,
    };
  });
  const digest = sha256(
    JSON.stringify({ accountId: i.accountId, format: i.format.id, rows }),
  );
  const existing = await tx.query(
    "select * from public.imports where file_sha256=$1",
    [i.key],
  );
  if (existing.rows[0]) {
    if (existing.rows[0].content_digest !== digest)
      throw new InputError(
        "This file was already imported with different settings. Nothing was changed.",
      );
    return {
      import: existing.rows[0],
      added: 0,
      unchanged: rows.length,
      replay: true,
    };
  }
  const created = await tx.query(
    `insert into public.imports(account_id,format,file_name,file_sha256,content_digest,row_count,coverage_start,coverage_end)
     values($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
    [
      i.accountId,
      i.format.id,
      i.fileName,
      i.key,
      digest,
      rows.length,
      i.coverageStart,
      i.coverageEnd,
    ],
  );
  const result = await tx.query(
    "select * from public.ingest_transactions($1,'csv',$2,$3)",
    [i.accountId, JSON.stringify(rows), created.rows[0].id],
  );
  if (i.coverageStart && i.coverageEnd)
    await tx.query("select public.record_account_sync($1,$2,$3,null)", [
      i.accountId,
      i.coverageStart,
      i.coverageEnd,
    ]);
  return {
    import: created.rows[0],
    added: Number(result.rows[0].added),
    unchanged: Number(result.rows[0].unchanged),
    replay: false,
  };
}

async function importSingle(
  tx: Tx,
  input: ImportInput,
  statement: ReturnType<typeof parseStatement>,
  fileHash: string,
) {
  let accountId = input.account_id;
  if (!accountId) {
    if (!input.new_account)
      throw new InputError("Choose an account for this file.");
    const created = await tx.query(
      `insert into public.accounts(source,external_ref,institution,name,mask,kind)
       values('csv',$1,$2,$3,$4,'credit') returning id`,
      [
        sha256(`account:csv\u0000${randomUUID()}`),
        input.new_account.institution,
        input.new_account.name,
        input.new_account.mask,
      ],
    );
    accountId = created.rows[0].id as string;
  }
  const account = await tx.query(
    "select id, source from public.accounts where id=$1",
    [accountId],
  );
  if (account.rows[0]?.source !== "csv")
    throw new InputError("CSV files import into CSV accounts only.");
  const r = await ingest(tx, {
    accountId,
    format: statement.format,
    fileName: input.file_name,
    key: fileHash,
    rows: statement.rows,
    coverageStart: statement.coverageStart,
    coverageEnd: statement.coverageEnd,
  });
  const matched = r.replay ? null : await runMatchersSafely(tx, "manual");
  return {
    matched,
    import: r.import,
    added: r.added,
    unchanged: r.unchanged,
    format: {
      id: statement.format.id,
      label: statement.format.label,
      verified: statement.format.verified,
    },
    replay: r.replay,
  };
}

// The card an exported account belongs to: the card of an account the owner linked with the same
// last four digits, else the one active card with those digits, else (without digits) the one
// active card of the product the account is named after.
function cardForExported(
  a: CsvAccount,
  owned: OwnedAccount[],
  cards: Card[],
): { card: Card | null; reason: string | null } {
  const active = cards.filter(
    (c) => c.status === "active" && c.identity_verified_at,
  );
  if (a.mask) {
    const linkedIds = new Set(
      owned
        .filter(
          (o) =>
            o.mask === a.mask && o.mapping_status === "confirmed" && o.card_id,
        )
        .map((o) => o.card_id as string),
    );
    if (linkedIds.size > 1)
      return {
        card: null,
        reason: "Its digits are linked to more than one card.",
      };
    if (linkedIds.size === 1) {
      const id = [...linkedIds][0];
      const card = cards.find((c) => c.id === id);
      return card && card.status === "active"
        ? { card, reason: null }
        : { card: null, reason: "Its card is not active." };
    }
    const sameDigits = active.filter((c) => c.last4 === a.mask);
    if (sameDigits.length === 1) return { card: sameDigits[0], reason: null };
    return {
      card: null,
      reason: sameDigits.length
        ? "Its digits belong to more than one card."
        : "No card has its last four digits.",
    };
  }
  // Without digits, only an account named exactly like a card product is placed, so "Apple Cash"
  // never lands on the Apple Card.
  const { product } = identifyAccount({ institution: "", name: a.name });
  const exact =
    product &&
    [product.display_name, product.product_name].some(
      (n) =>
        n.toLowerCase() === a.name.replace(/\s+/g, " ").trim().toLowerCase(),
    );
  if (!product || !exact)
    return {
      card: null,
      reason: "It has no digits and is not named like a card product.",
    };
  const same = active.filter((c) => c.catalog_key === product.key);
  if (same.length === 1) return { card: same[0], reason: null };
  return {
    card: null,
    reason: same.length
      ? "More than one card matches its product."
      : "No active card matches its product.",
  };
}

async function importMulti(
  tx: Tx,
  input: ImportInput,
  statement: ReturnType<typeof parseStatement>,
  fileHash: string,
) {
  const groups = new Map<string, { account: CsvAccount; rows: CsvRow[] }>();
  for (const r of statement.rows) {
    const key = accountKey(r.account!);
    const g = groups.get(key) ?? { account: r.account!, rows: [] };
    g.rows.push(r);
    groups.set(key, g);
  }
  const { rows: owned } = await tx.query<OwnedAccount>(
    `select a.id, a.source, a.external_ref, a.mask, a.card_id, a.mapping_status,
            c.earliest_synced_on, c.synced_through, c.last_error
     from public.accounts a left join public.account_coverage c on c.account_id=a.id`,
  );
  const { rows: cards } = await tx.query<Card>(
    `select id, issuer, display_name, last4, catalog_key, status, identity_verified_at
     from public.cards where archived_at is null`,
  );
  const accounts: AccountImport[] = [];
  let added = 0,
    replay = true;
  for (const { account, rows } of [...groups.values()].sort((x, y) =>
    x.account.name.localeCompare(y.account.name),
  )) {
    const base: AccountImport = {
      account: account.name,
      digits: account.mask,
      card: null,
      status: "skipped",
      reason: null,
      rows: rows.length,
      added: 0,
      unchanged: 0,
      left_to_sync: 0,
      coverage_start: null,
      coverage_end: null,
    };
    const { card, reason } = cardForExported(account, owned, cards);
    if (!card) {
      accounts.push({ ...base, reason });
      continue;
    }
    base.card = card.display_name;
    // Rows from the first day another linked account's history begins belong to that account.
    const cutoff = owned
      .filter(
        (o) =>
          o.card_id === card.id &&
          o.source !== "csv" &&
          !o.last_error &&
          o.earliest_synced_on,
      )
      .map((o) => o.earliest_synced_on as string)
      .sort()[0];
    const kept = cutoff ? rows.filter((r) => r.transactedOn < cutoff) : rows;
    base.left_to_sync = rows.length - kept.length;
    if (!kept.length) {
      accounts.push({
        ...base,
        reason: "A synced account already covers every row.",
      });
      continue;
    }
    const externalRef = sha256(
      `account:csv:export\u0000${accountKey(account)}`,
    );
    let target = owned.find(
      (o) => o.source === "csv" && o.external_ref === externalRef,
    );
    if (!target) {
      const created = await tx.query<OwnedAccount>(
        `insert into public.accounts(source,external_ref,institution,name,mask,kind,proposed_card_id,card_id,mapping_status,mapping_confirmed_at)
         values('csv',$1,$2,$3,$4,'credit',$5,$5,'confirmed',now()) returning id, source, external_ref, mask, card_id, mapping_status`,
        [
          externalRef,
          card.issuer,
          `${card.display_name} (${statement.format.label.split(" (")[0]})`.slice(
            0,
            200,
          ),
          account.mask,
          card.id,
        ],
      );
      target = created.rows[0];
      owned.push(target);
    } else if (target.card_id !== card.id) {
      accounts.push({
        ...base,
        reason: "Its earlier import is linked to a different card.",
      });
      continue;
    }
    const dates = kept.map((r) => r.transactedOn).sort();
    const lastInFile = rows
      .map((r) => r.transactedOn)
      .sort()
      .at(-1)!;
    const coverageEnd =
      cutoff && shiftDays(cutoff, -1) < lastInFile
        ? shiftDays(cutoff, -1)
        : lastInFile;
    const r = await ingest(tx, {
      accountId: target.id,
      format: statement.format,
      fileName: input.file_name,
      key: sha256(`${fileHash}\u0000${accountKey(account)}`),
      rows: kept,
      coverageStart: dates[0],
      coverageEnd,
    });
    added += r.added;
    if (!r.replay) replay = false;
    accounts.push({
      ...base,
      status: r.replay ? "unchanged" : "imported",
      added: r.added,
      unchanged: r.unchanged,
      coverage_start: dates[0],
      coverage_end: coverageEnd,
    });
  }
  const matched = replay ? null : await runMatchersSafely(tx, "manual");
  return {
    matched,
    accounts,
    added,
    format: {
      id: statement.format.id,
      label: statement.format.label,
      verified: statement.format.verified,
    },
    replay,
  };
}

export async function importStatement(tx: Tx, input: ImportInput) {
  let statement;
  try {
    statement = parseStatement(input.file_text, input.format);
  } catch (e) {
    throw new InputError(e instanceof Error ? e.message : "Unreadable CSV.");
  }
  const fileHash = sha256(input.file_text);
  return statement.format.account
    ? importMulti(tx, input, statement, fileHash)
    : importSingle(tx, input, statement, fileHash);
}
