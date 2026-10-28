import "server-only";
import type pg from "pg";
import { z } from "zod";
import type {
  AuditEvent,
  Benefit,
  Card,
  Evidence,
  Period,
  Snapshot,
  SyncRun,
} from "@/lib/types";
import { localDate } from "@/lib/domain";
import {
  operations,
  type OperationName,
  type Operations,
} from "@/lib/ledger-ops";
import { LedgerError } from "./db";

type Client = pg.PoolClient | pg.Client;

// to_jsonb renders dates as YYYY-MM-DD, timestamps as ISO 8601 and bigints as
// numbers, which is the shape the browser types expect.
async function rows<T>(c: Client, from: string, order: string): Promise<T[]> {
  const result = await c.query<{ r: T[] }>(
    `select coalesce(jsonb_agg(to_jsonb(t) order by ${order}), '[]'::jsonb) as r from ${from} t`,
  );
  return result.rows[0].r;
}
async function one<T>(c: Client, sql: string, params: unknown[]) {
  const result = await c.query<{ r: T }>(sql, params);
  if (!result.rows.length || result.rows[0].r === null)
    throw new LedgerError("That record is unavailable.", 404);
  return result.rows[0].r;
}

export async function loadSnapshot(c: Client): Promise<Snapshot> {
  const cards = await rows<Card>(c, "public.cards", "t.created_at, t.id");
  const benefits = await rows<Benefit>(
    c,
    "public.benefits",
    "t.created_at, t.id",
  );
  const periodErrors: string[] = [];
  for (const b of benefits) {
    const card = cards.find((x) => x.id === b.card_id),
      today = localDate(new Date(), card?.issuer_timezone);
    if (
      !b.enabled ||
      card?.status !== "active" ||
      b.effective_from > today ||
      (b.effective_to && b.effective_to <= today)
    )
      continue;
    // A savepoint keeps one unresolved rule from aborting the whole snapshot.
    await c.query("savepoint ensure_period");
    try {
      await c.query("select public.ensure_period($1)", [b.id]);
      await c.query("release savepoint ensure_period");
    } catch (error) {
      await c.query("rollback to savepoint ensure_period");
      periodErrors.push(`${b.name}: ${(error as Error).message}`);
    }
  }
  cards.sort((a, b) => a.display_name.localeCompare(b.display_name));
  return {
    cards,
    benefits,
    periods: await rows<Period>(
      c,
      "public.period_balances",
      "t.period_start desc, t.id",
    ),
    evidence: await rows<Evidence>(
      c,
      "public.redemption_evidence",
      "t.recorded_at desc, t.id",
    ),
    runs: await rows<SyncRun>(c, "public.sync_runs", "t.started_at desc, t.id"),
    audit: await rows<AuditEvent>(
      c,
      "public.audit_events",
      "t.occurred_at desc, t.id desc",
    ),
    periodErrors,
  };
}

const BENEFIT_COLUMNS = [
  "card_id",
  "name",
  "description",
  "category",
  "cadence",
  "nominal_amount_cents",
  "nominal_units",
  "unit_label",
  "reset_anchor",
  "custom_end_exclusive",
  "effective_from",
  "effective_to",
  "enrollment_required",
  "enrollment_status",
  "eligibility_status",
  "manual_verification_required",
  "eligibility_rules_json",
  "issuer_source_url",
  "verified_at",
  "enabled",
].join(",");

type Input<K extends OperationName> = z.output<Operations[K]>;
const handlers: {
  [K in OperationName]: (c: Client, input: Input<K>) => Promise<unknown>;
} = {
  initialize_cards: async (c) => {
    await c.query("select public.initialize_cards()");
    return null;
  },
  update_card: (c, i) =>
    one(
      c,
      `update public.cards set display_name=$2, product_name=$3, last4=$4, status=$5,
         cardmember_anchor_date=$6, issuer_timezone=$7, identity_verified_at=now()
       where id=$1 returning to_jsonb(cards.*) as r`,
      [
        i.id,
        i.display_name,
        i.product_name,
        i.last4,
        i.status,
        i.cardmember_anchor_date,
        i.issuer_timezone,
      ],
    ),
  create_benefit: (c, i) =>
    one(
      c,
      `insert into public.benefits(${BENEFIT_COLUMNS})
       select ${BENEFIT_COLUMNS} from jsonb_populate_record(null::public.benefits, $1::jsonb)
       returning to_jsonb(benefits.*) as r`,
      [JSON.stringify(i)],
    ),
  version_benefit: (c, i) =>
    one(c, "select to_jsonb(public.version_benefit($1, $2::jsonb, $3)) as r", [
      i.benefit_id,
      JSON.stringify(i.changes),
      i.effective_from,
    ]),
  set_benefit_enabled: (c, i) =>
    one(
      c,
      "update public.benefits set enabled=$2 where id=$1 returning to_jsonb(benefits.*) as r",
      [i.benefit_id, i.enabled],
    ),
  confirm_enrollment: (c, i) =>
    one(
      c,
      "update public.benefits set enrollment_status='active' where id=$1 returning to_jsonb(benefits.*) as r",
      [i.benefit_id],
    ),
  ensure_period: (c, i) =>
    one(c, "select to_jsonb(public.ensure_period($1, $2)) as r", [
      i.benefit_id,
      i.on ?? null,
    ]),
  record_evidence: (c, i) =>
    one(c, "select to_jsonb(public.record_evidence($1::jsonb)) as r", [
      JSON.stringify(i.record),
    ]),
  update_period_notes: (c, i) =>
    one(
      c,
      "update public.benefit_periods set notes=$2 where id=$1 returning to_jsonb(benefit_periods.*) as r",
      [i.period_id, i.notes],
    ),
  apply_reconciliation: (c, i) =>
    one(
      c,
      "select to_jsonb(public.apply_reconciliation($1, $2, $3::jsonb, $4::jsonb, $5::jsonb)) as r",
      [
        i.request_key,
        i.trigger,
        JSON.stringify(i.periods),
        JSON.stringify(i.evidence),
        JSON.stringify(i.summary),
      ],
    ),
};

/** Validates an untrusted request and runs exactly one allow-listed operation. */
export async function runOperation(c: Client, op: unknown, input: unknown) {
  if (typeof op !== "string" || !Object.hasOwn(operations, op))
    throw new LedgerError("Unknown ledger operation.");
  const name = op as OperationName;
  const parsed = operations[name].safeParse(input ?? {});
  if (!parsed.success)
    throw new LedgerError(
      `Invalid ${name.replaceAll("_", " ")} request: ${parsed.error.issues
        .slice(0, 3)
        .map((x) => `${x.path.join(".") || "input"} ${x.message}`)
        .join("; ")}`,
    );
  return (handlers[name] as (c: Client, i: unknown) => Promise<unknown>)(
    c,
    parsed.data,
  );
}
