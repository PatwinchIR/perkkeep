// Row types for the PostgreSQL schema in db/migrations. Dates are ISO strings (see
// src/server/pg-types.ts); jsonb columns are parsed JSON.
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

// public.cards
export type CardRow = {
  cardmember_anchor_date: string | null;
  catalog_key: string | null;
  created_at: string;
  display_name: string;
  id: string;
  identity_verified_at: string | null;
  issuer: string;
  issuer_timezone: string;
  last4: string | null;
  owner_user_id: string;
  product_name: string | null;
  status: string;
  updated_at: string;
};

// public.benefits
export type BenefitRow = {
  cadence: string;
  card_id: string;
  category: string;
  created_at: string;
  custom_end_exclusive: string | null;
  description: string;
  effective_from: string;
  effective_to: string | null;
  eligibility_rules_json: NonNullable<Json>;
  eligibility_status: string;
  enabled: boolean;
  enrollment_required: boolean;
  enrollment_status: string;
  id: string;
  issuer_source_url: string | null;
  manual_verification_required: boolean;
  name: string;
  nominal_amount_cents: number | null;
  nominal_units: number | null;
  owner_user_id: string;
  reset_anchor: string | null;
  rule_key: string;
  unit_label: string | null;
  updated_at: string;
  verified_at: string | null;
  last_reverified_at: string | null;
};

// public.alert_acknowledgements
export type AcknowledgementRow = {
  id: string;
  owner_user_id: string;
  alert_key: string;
  acknowledged_at: string;
  context: NonNullable<Json>;
};

// public.user_settings
export type UserSettingsRow = {
  owner_user_id: string;
  alert_lead_days: number;
  created_at: string;
  updated_at: string;
};

// public.benefit_periods
export type PeriodRow = {
  allowance_cents: number | null;
  allowance_units: number | null;
  benefit_id: string;
  card_id: string;
  coverage_status: string;
  coverage_through: string | null;
  created_at: string;
  id: string;
  last_reconciled_at: string | null;
  notes: string;
  owner_user_id: string;
  period_end_exclusive: string;
  period_start: string;
  rule_snapshot: NonNullable<Json>;
  updated_at: string;
};

// public.redemption_evidence
export type EvidenceRow = {
  amount_cents: number | null;
  benefit_period_id: string;
  card_id: string;
  confidence: string;
  confirmation_result: string;
  eligibility_result: string;
  id: string;
  merchant: string | null;
  notes: string;
  owner_user_id: string;
  recorded_at: string;
  recorded_by: string;
  source_reference_hash: string | null;
  source_type: string;
  supersedes_evidence_id: string | null;
  transaction_date: string;
  units: number | null;
};

// public.sync_runs
export type SyncRunRow = {
  candidates_found: number;
  confirmed_updates: number;
  coverage_summary_json: NonNullable<Json>;
  error_summary: string | null;
  finished_at: string | null;
  id: string;
  owner_user_id: string;
  periods_checked: number;
  request_digest: string | null;
  request_key: string;
  started_at: string;
  status: string;
  trigger: string;
};

// public.audit_events
export type AuditEventRow = {
  action: string;
  entity_id: string;
  entity_table: string;
  id: number;
  new_record: Json | null;
  occurred_at: string;
  old_record: Json | null;
  owner_user_id: string;
};
