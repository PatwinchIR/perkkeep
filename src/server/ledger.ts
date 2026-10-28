import { z } from "zod";
import type { Tx } from "./db";
import { DEFAULT_SETTINGS, type Snapshot, type Period } from "@/lib/types";
import { localDate } from "@/lib/domain";
import { RULE_FILES } from "@/lib/catalog";

const uuid = z.uuid();
const day = z.iso.date();
const text = (max: number) => z.string().max(max);
const nullableDay = day.nullable().optional();

export class InputError extends Error {}

// A fixed set of operations. The browser never sends SQL, table names or column lists.
export const operations = {
  updateCard: z.object({
    id: uuid,
    display_name: text(100).min(1),
    product_name: text(150).nullable(),
    last4: z
      .string()
      .regex(/^[0-9]{4}$/)
      .nullable(),
    status: z.enum(["active", "closed", "unknown"]),
    cardmember_anchor_date: nullableDay,
    issuer_timezone: text(64).min(1),
  }),
  createBenefit: z.object({
    card_id: uuid,
    name: text(150).min(1),
    description: text(4000),
    category: text(60),
    cadence: z.enum([
      "monthly",
      "quarterly",
      "semiannual",
      "calendar_year",
      "cardmember_year",
      "one_time",
      "custom",
    ]),
    nominal_amount_cents: z.number().int().min(0).nullable(),
    nominal_units: z.number().int().min(0).nullable(),
    unit_label: text(40).nullable(),
    reset_anchor: nullableDay,
    custom_end_exclusive: nullableDay,
    effective_from: day,
    effective_to: nullableDay,
    enrollment_required: z.boolean(),
    enrollment_status: z.enum([
      "unknown",
      "active",
      "inactive",
      "not_required",
    ]),
    eligibility_status: z.enum(["unknown", "eligible", "ineligible"]),
    manual_verification_required: z.boolean(),
    eligibility_rules_json: z.record(z.string(), z.unknown()),
    issuer_source_url: z.url({ protocol: /^https$/ }),
  }),
  versionBenefit: z.object({
    benefit_id: uuid,
    effective_from: day,
    changes: z.record(z.string(), z.unknown()),
  }),
  setBenefitEnabled: z.object({ id: uuid, enabled: z.boolean() }),
  markEnrolled: z.object({ id: uuid }),
  markEligible: z.object({ id: uuid }),
  // The owner re-read the issuer's terms and found them unchanged.
  markReverified: z.object({ id: uuid }),
  // One-time allowance for a period that starts inside a partial rule window.
  confirmPeriodAllowance: z.object({
    id: uuid,
    amount_cents: z.number().int().min(0).nullable(),
    units: z.number().int().min(0).nullable(),
    note: text(4000).min(1),
  }),
  acknowledgeAlert: z.object({
    alert_key: z.string().min(1).max(200),
    context: z.record(z.string(), z.unknown()).default({}),
  }),
  updateSettings: z.object({
    alert_lead_days: z.number().int().min(1).max(90),
  }),
  ensurePeriod: z.object({ benefit_id: uuid, on: day }),
  initializeCards: z.object({}),
  addResearchedBenefits: z.object({ card_id: uuid }),
  setPeriodNote: z.object({ id: uuid, notes: text(4000) }),
  recordEvidence: z.object({
    id: uuid.optional(),
    benefit_period_id: uuid,
    source_type: z.enum([
      "purchase",
      "statement_credit",
      "email_confirmation",
      "issuer_portal",
      "manual",
      "refund",
      "reversal",
    ]),
    source_reference_hash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable()
      .optional(),
    transaction_date: day,
    merchant: text(200).nullable().optional(),
    amount_cents: z.number().int().nullable().optional(),
    units: z.number().int().nullable().optional(),
    eligibility_result: z
      .enum(["eligible", "unknown", "ineligible"])
      .optional(),
    confirmation_result: text(200).optional(),
    confidence: z.enum(["confirmed", "candidate", "unknown", "rejected"]),
    notes: text(4000).optional(),
    supersedes_evidence_id: uuid.nullable().optional(),
  }),
  applyReconciliation: z.object({
    request_key: uuid,
    periods: z
      .array(
        z.object({
          id: uuid,
          coverage_status: z.enum(["complete", "partial", "unavailable"]),
          coverage_through: day.nullable(),
        }),
      )
      .max(500),
    description: text(2000),
  }),
} as const;
export type Operation = keyof typeof operations;
export type OperationInput<O extends Operation> = z.infer<
  (typeof operations)[O]
>;

// Fields the owner may change through versioning; identity and ownership are never accepted.
const VERSIONABLE = new Set([
  "name",
  "description",
  "category",
  "cadence",
  "nominal_amount_cents",
  "nominal_units",
  "unit_label",
  "reset_anchor",
  "custom_end_exclusive",
  "enrollment_required",
  "enrollment_status",
  "eligibility_status",
  "manual_verification_required",
  "eligibility_rules_json",
  "issuer_source_url",
  "verified_at",
  "enabled",
]);

// Adds each researched rule (data/benefits) for a confirmed card that the card does not have yet.
// The card's confirmed identity and the issuer's verified terms make it eligible; enrollment
// stays unknown until the owner confirms it, and rules the issuer gives no start date for begin
// on January 1 of this year, marked as a default for the owner to correct. Rules that need
// owner-specific dates (custom windows) and rules that have ended are skipped.
const CATEGORIES: [RegExp, string][] = [
  [/dining|resy|dunkin|doordash|grubhub/i, "Dining"],
  [/travel|lyft|uber|global entry|edit/i, "Travel"],
  [/stubhub|peloton/i, "Lifestyle"],
];
export async function addResearchedBenefits(tx: Tx, cardId: string) {
  const { rows: cards } = await tx.query(
    "select * from public.cards where id=$1",
    [cardId],
  );
  const card = cards[0];
  if (!card) throw new InputError("Card not found.");
  if (!card.identity_verified_at || card.status !== "active")
    throw new InputError("Confirm the active card before adding benefits.");
  const file = RULE_FILES.find((f) => f.catalog_key === card.catalog_key);
  if (!file?.researched)
    return { added: [] as string[], skipped: [] as string[] };
  const { rows: existing } = await tx.query(
    "select eligibility_rules_json->>'catalog_rule_id' as rule from public.benefits where card_id=$1",
    [cardId],
  );
  const today = localDate(new Date(), card.issuer_timezone);
  const added: string[] = [],
    skipped: string[] = [];
  for (const r of file.rules) {
    if (existing.some((e) => e.rule === r.id)) continue;
    if (
      !r.verified ||
      ["custom", "one_time"].includes(r.period) ||
      (r.effective_to && r.effective_to <= today)
    ) {
      skipped.push(r.name);
      continue;
    }
    const start = r.effective_from ?? `${today.slice(0, 4)}-01-01`;
    await tx.query(
      `insert into public.benefits(card_id,name,description,category,cadence,nominal_amount_cents,nominal_units,
         unit_label,effective_from,effective_to,enrollment_required,enrollment_status,eligibility_status,
         manual_verification_required,eligibility_rules_json,issuer_source_url,verified_at,enabled)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'eligible',$13,$14,$15,now(),true)`,
      [
        cardId,
        r.name,
        r.eligibility_notes,
        CATEGORIES.find(([re]) => re.test(r.name))?.[1] ?? "Other",
        r.period,
        r.amount_cents ?? null,
        r.units ?? null,
        r.unit_label ?? null,
        start,
        r.effective_to,
        r.enrollment_required,
        r.enrollment_required ? "unknown" : "not_required",
        r.manual,
        {
          conditions: r.eligibility_notes,
          source_observed_at: r.checked_on,
          effective_date_confirmed_by: r.effective_from
            ? "issuer"
            : "default_start_of_year",
          catalog_rule_id: r.id,
          catalog_rule_version: r.version,
          terms_verified: r.verified,
        },
        r.source_url,
      ],
    );
    added.push(r.name);
  }
  return { added, skipped };
}

async function one<T>(tx: Tx, sql: string, values: unknown[]): Promise<T> {
  const { rows } = await tx.query(sql, values);
  if (rows.length !== 1)
    throw new InputError("Record not found for this owner.");
  return rows[0] as T;
}

export async function runOperation(
  tx: Tx,
  op: Operation,
  raw: unknown,
): Promise<unknown> {
  const parsed = operations[op].safeParse(raw);
  if (!parsed.success)
    throw new InputError(
      `Invalid ${op} request: ${parsed.error.issues[0]?.message}`,
    );
  const input = parsed.data as Record<string, unknown>;
  switch (op) {
    case "updateCard": {
      const i = input as OperationInput<"updateCard">;
      return one(
        tx,
        `update public.cards set display_name=$2, product_name=$3, last4=$4, status=$5,
           cardmember_anchor_date=$6, issuer_timezone=$7, identity_verified_at=now()
         where id=$1 returning *`,
        [
          i.id,
          i.display_name,
          i.product_name,
          i.last4,
          i.status,
          i.cardmember_anchor_date ?? null,
          i.issuer_timezone,
        ],
      );
    }
    case "addResearchedBenefits": {
      const i = input as OperationInput<"addResearchedBenefits">;
      return addResearchedBenefits(tx, i.card_id);
    }
    case "createBenefit": {
      const i = input as OperationInput<"createBenefit">;
      return one(
        tx,
        `insert into public.benefits(card_id,name,description,category,cadence,nominal_amount_cents,nominal_units,
           unit_label,reset_anchor,custom_end_exclusive,effective_from,effective_to,enrollment_required,enrollment_status,
           eligibility_status,manual_verification_required,eligibility_rules_json,issuer_source_url,verified_at,enabled)
         values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,now(),true) returning *`,
        [
          i.card_id,
          i.name,
          i.description,
          i.category || "Other",
          i.cadence,
          i.nominal_amount_cents,
          i.nominal_units,
          i.unit_label,
          i.reset_anchor ?? null,
          i.custom_end_exclusive ?? null,
          i.effective_from,
          i.effective_to ?? null,
          i.enrollment_required,
          i.enrollment_status,
          i.eligibility_status,
          i.manual_verification_required,
          i.eligibility_rules_json,
          i.issuer_source_url,
        ],
      );
    }
    case "versionBenefit": {
      const i = input as OperationInput<"versionBenefit">;
      const changes = Object.fromEntries(
        Object.entries(i.changes).filter(([k]) => VERSIONABLE.has(k)),
      );
      return one(tx, "select * from public.version_benefit($1,$2,$3)", [
        i.benefit_id,
        { ...changes, verified_at: new Date().toISOString(), enabled: true },
        i.effective_from,
      ]);
    }
    case "setBenefitEnabled": {
      const i = input as OperationInput<"setBenefitEnabled">;
      return one(
        tx,
        "update public.benefits set enabled=$2 where id=$1 returning *",
        [i.id, i.enabled],
      );
    }
    case "markEnrolled": {
      const i = input as OperationInput<"markEnrolled">;
      return one(
        tx,
        "update public.benefits set enrollment_status='active' where id=$1 returning *",
        [i.id],
      );
    }
    case "markEligible": {
      const i = input as OperationInput<"markEligible">;
      return one(
        tx,
        "update public.benefits set eligibility_status='eligible' where id=$1 returning *",
        [i.id],
      );
    }
    case "markReverified": {
      const i = input as OperationInput<"markReverified">;
      return one(
        tx,
        "update public.benefits set last_reverified_at=now() where id=$1 returning *",
        [i.id],
      );
    }
    case "confirmPeriodAllowance": {
      const i = input as OperationInput<"confirmPeriodAllowance">;
      return one(
        tx,
        "select * from public.confirm_period_allowance($1,$2,$3,$4)",
        [i.id, i.amount_cents, i.units, i.note],
      );
    }
    case "acknowledgeAlert": {
      const i = input as OperationInput<"acknowledgeAlert">;
      // A repeated acknowledgement is a no-op; the first one is kept.
      await tx.query(
        `insert into public.alert_acknowledgements(alert_key,context) values($1,$2)
         on conflict(owner_user_id,alert_key) do nothing`,
        [i.alert_key, i.context],
      );
      return { acknowledged: i.alert_key };
    }
    case "updateSettings": {
      const i = input as OperationInput<"updateSettings">;
      return one(
        tx,
        `insert into public.user_settings(alert_lead_days) values($1)
         on conflict(owner_user_id) do update set alert_lead_days=excluded.alert_lead_days
         returning alert_lead_days`,
        [i.alert_lead_days],
      );
    }
    case "ensurePeriod": {
      const i = input as OperationInput<"ensurePeriod">;
      return one(tx, "select * from public.ensure_period($1,$2)", [
        i.benefit_id,
        i.on,
      ]);
    }
    case "initializeCards":
      await tx.query("select public.initialize_cards()");
      return null;
    case "setPeriodNote": {
      const i = input as OperationInput<"setPeriodNote">;
      return one(
        tx,
        "update public.benefit_periods set notes=$2 where id=$1 returning *",
        [i.id, i.notes],
      );
    }
    case "recordEvidence":
      // Evidence entered in the app is the owner's own record; provenance is not client-selectable.
      return one(tx, "select * from public.record_evidence($1)", [
        { ...input, recorded_by: "user" },
      ]);
    case "applyReconciliation": {
      const i = input as OperationInput<"applyReconciliation">;
      const run = await one<{ status: string; error_summary: string | null }>(
        tx,
        "select * from public.apply_reconciliation($1,'manual',$2,'[]'::jsonb,$3)",
        [
          i.request_key,
          JSON.stringify(i.periods),
          {
            source: "user_review",
            description: i.description,
            finances_available: "not_tested",
          },
        ],
      );
      return run;
    }
  }
}

// Reads everything the PWA shows. Current periods are created inside savepoints so one rule that
// cannot generate a period (for example, an unconfirmed anniversary) does not hide the others.
export async function loadSnapshot(tx: Tx): Promise<Snapshot> {
  // Once a synced account is linked, starter cards that nothing has confirmed, linked or given
  // benefits are hidden (D41). They stay in the database and reappear if every link is removed.
  const cards = (
    await tx.query(
      `select * from public.cards c
       where not (
         c.last4 is null and c.identity_verified_at is null
         and exists(select 1 from public.accounts a where a.mapping_status='confirmed')
         and not exists(select 1 from public.accounts a where a.card_id=c.id or a.proposed_card_id=c.id)
         and not exists(select 1 from public.benefits b where b.card_id=c.id)
       )
       order by display_name, id`,
    )
  ).rows;
  const benefits = (
    await tx.query("select * from public.benefits order by created_at, id")
  ).rows;
  const periodErrors: string[] = [];
  for (const b of benefits) {
    const card = cards.find((c) => c.id === b.card_id);
    const today = localDate(new Date(), card?.issuer_timezone);
    if (!(
      b.enabled &&
      card?.status === "active" &&
      b.effective_from <= today &&
      (!b.effective_to || b.effective_to > today)
    ))
      continue;
    await tx.query("savepoint ensure_period");
    try {
      await tx.query("select public.ensure_period($1)", [b.id]);
      await tx.query("release savepoint ensure_period");
    } catch (e) {
      await tx.query("rollback to savepoint ensure_period");
      periodErrors.push(
        `${b.name}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  // One client runs one query at a time.
  const periods = await tx.query(
    "select * from public.period_balances order by period_start desc, id",
  );
  const evidence = await tx.query(
    "select * from public.redemption_evidence order by recorded_at desc, id",
  );
  const runs = await tx.query(
    "select * from public.sync_runs order by started_at desc, id",
  );
  const audit = await tx.query(
    "select * from public.audit_events order by occurred_at desc, id desc limit 1000",
  );
  const accounts = await tx.query(
    `select a.id, a.source, a.connection_id, a.institution, a.name, a.mask, a.kind, a.currency, a.proposed_card_id,
       a.card_id, a.mapping_status, a.mapping_confirmed_at, a.created_at,
       c.earliest_synced_on, c.synced_through, c.last_attempted_at, c.last_success_at, c.last_error,
       (select count(*) from public.transactions t where t.account_id=a.id)::int as transaction_rows,
       (select b.balance_cents from public.balance_snapshots b where b.account_id=a.id order by b.observed_at desc limit 1) as balance_cents,
       (select b.observed_at from public.balance_snapshots b where b.account_id=a.id order by b.observed_at desc limit 1) as balance_observed_at
     from public.accounts a left join public.account_coverage c on c.account_id=a.id
     order by a.institution, a.name, a.id`,
  );
  // Connection secrets never leave the server.
  const connections = await tx.query(
    "select id, source, label, status, last_attempted_at, last_success_at, last_error, created_at from public.source_connections order by created_at",
  );
  const syncs = await tx.query(
    "select * from public.source_syncs order by started_at desc limit 50",
  );
  const imports = await tx.query(
    "select id, account_id, format, file_name, row_count, coverage_start, coverage_end, created_at from public.imports order by created_at desc limit 50",
  );
  // Image bytes are served separately by /api/card-art/[id].
  const cardArt = await tx.query(
    "select card_id, sha256, origin, bands, overlay, updated_at from public.card_art",
  );
  const acknowledgements = await tx.query(
    "select alert_key, acknowledged_at from public.alert_acknowledgements order by acknowledged_at desc, id",
  );
  const settings = await tx.query(
    "select alert_lead_days from public.user_settings",
  );
  return {
    acknowledgements: acknowledgements.rows,
    settings: settings.rows[0] ?? DEFAULT_SETTINGS,
    cardArt: cardArt.rows,
    accounts: accounts.rows,
    connections: connections.rows,
    syncs: syncs.rows,
    imports: imports.rows,
    cards,
    benefits,
    periods: periods.rows as Period[],
    evidence: evidence.rows,
    runs: runs.rows,
    audit: audit.rows,
    periodErrors,
  };
}
