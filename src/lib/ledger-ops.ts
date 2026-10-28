// The complete set of ledger writes the app can request. Both backends accept the
// same operations; the hosted server validates every request against these schemas
// before it reaches PostgreSQL. Browser code imports only the inferred types.
import { z } from "zod";

const uuid = z.uuid();
const day = z.iso.date();
const text = (max: number) => z.string().max(max);
const cadence = z.enum([
  "monthly",
  "quarterly",
  "semiannual",
  "calendar_year",
  "cardmember_year",
  "one_time",
  "custom",
]);
const int = z.number().int().min(-2147483648).max(2147483647);
const nonNegative = z.number().int().min(0).max(2147483647);
const jsonValue: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string().max(4000),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValue).max(100),
    z.record(z.string().max(100), jsonValue),
  ]),
);
const jsonObject = z
  .record(z.string().max(100), jsonValue)
  .refine((v) => JSON.stringify(v).length <= 20000, "Summary is too large");

const benefitTerms = z
  .object({
    name: z.string().min(1).max(150),
    description: text(4000),
    category: z.string().min(1).max(100),
    cadence,
    nominal_amount_cents: nonNegative.nullable(),
    nominal_units: nonNegative.nullable(),
    unit_label: text(50).nullable(),
    reset_anchor: day.nullable(),
    custom_end_exclusive: day.nullable(),
    effective_from: day,
    effective_to: day.nullable(),
    enrollment_required: z.boolean(),
    enrollment_status: z.enum([
      "unknown",
      "active",
      "inactive",
      "not_required",
    ]),
    eligibility_status: z.enum(["unknown", "eligible", "ineligible"]),
    manual_verification_required: z.boolean(),
    eligibility_rules_json: jsonObject,
    issuer_source_url: z.url({ protocol: /^https$/ }).max(2000),
    verified_at: z.iso.datetime({ offset: true }),
    enabled: z.boolean(),
  })
  .strict();

export const evidenceRecord = z
  .object({
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
    amount_cents: int.nullable().optional(),
    units: int.nullable().optional(),
    eligibility_result: z
      .enum(["eligible", "unknown", "ineligible"])
      .optional(),
    confirmation_result: text(500).optional(),
    confidence: z.enum(["confirmed", "candidate", "unknown", "rejected"]),
    recorded_by: z.enum(["user", "import", "inference"]).optional(),
    notes: text(4000).optional(),
    supersedes_evidence_id: uuid.nullable().optional(),
  })
  .strict();

export const reconciliationRequest = z
  .object({
    request_key: uuid,
    trigger: z.enum(["manual", "scheduled", "user_edit"]),
    periods: z
      .array(
        z
          .object({
            id: uuid,
            coverage_status: z.enum(["complete", "partial", "unavailable"]),
            coverage_through: day.nullable(),
          })
          .strict(),
      )
      .max(200),
    evidence: z.array(evidenceRecord).max(500),
    summary: jsonObject,
  })
  .strict();

export const operations = {
  initialize_cards: z.object({}).strict(),
  update_card: z
    .object({
      id: uuid,
      display_name: z.string().min(1).max(100),
      product_name: text(100).nullable(),
      last4: z
        .string()
        .regex(/^[0-9]{4}$/)
        .nullable(),
      status: z.enum(["active", "closed", "unknown"]),
      cardmember_anchor_date: day.nullable(),
      issuer_timezone: z.string().min(1).max(64),
    })
    .strict(),
  create_benefit: benefitTerms.extend({ card_id: uuid }).strict(),
  version_benefit: z
    .object({ benefit_id: uuid, effective_from: day, changes: benefitTerms })
    .strict(),
  set_benefit_enabled: z
    .object({ benefit_id: uuid, enabled: z.boolean() })
    .strict(),
  confirm_enrollment: z.object({ benefit_id: uuid }).strict(),
  ensure_period: z.object({ benefit_id: uuid, on: day.optional() }).strict(),
  record_evidence: z.object({ record: evidenceRecord }).strict(),
  update_period_notes: z
    .object({ period_id: uuid, notes: text(4000) })
    .strict(),
  apply_reconciliation: reconciliationRequest,
} as const;

export type Operations = typeof operations;
export type OperationName = keyof Operations;
export type OperationInput<K extends OperationName> = z.input<Operations[K]>;
export type ReconciliationRequest = z.input<typeof reconciliationRequest>;
export const operationNames = Object.keys(operations) as OperationName[];
