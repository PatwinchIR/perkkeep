import type {
  AcknowledgementRow,
  AuditEventRow,
  BenefitRow,
  CardRow,
  EvidenceRow,
  Json,
  PeriodRow,
  SyncRunRow,
  UserSettingsRow,
} from "./rows";
export type Card = CardRow;
export type Benefit = BenefitRow;
export type Evidence = EvidenceRow;
export type SyncRun = SyncRunRow;
export type AuditEvent = AuditEventRow;
export type Acknowledgement = Pick<
  AcknowledgementRow,
  "alert_key" | "acknowledged_at"
>;
export type UserSettings = Pick<UserSettingsRow, "alert_lead_days">;
export const DEFAULT_SETTINGS: UserSettings = { alert_lead_days: 7 };
export type Period = PeriodRow & {
  benefit_name: string;
  cadence: string;
  enrollment_required: boolean;
  enrollment_status: string;
  eligibility_status: string;
  enabled: boolean;
  card_name: string;
  last4: string | null;
  issuer: string;
  issuer_timezone: string;
  card_status: string;
  identity_verified_at: string | null;
  confirmed_cents: number;
  candidate_cents: number;
  confirmed_units: number;
  candidate_units: number;
  remaining_cents: number | null;
  remaining_units: number | null;
  unresolved_count: number;
  negative_balance: boolean;
};
export type Account = {
  id: string;
  source: "simplefin" | "plaid" | "csv" | "manual";
  connection_id: string | null;
  institution: string;
  name: string;
  mask: string | null;
  kind: string;
  currency: string;
  proposed_card_id: string | null;
  card_id: string | null;
  mapping_status: "unmapped" | "proposed" | "confirmed" | "rejected";
  mapping_confirmed_at: string | null;
  created_at: string;
  earliest_synced_on: string | null;
  synced_through: string | null;
  last_attempted_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  transaction_rows: number;
  balance_cents: number | null;
  balance_observed_at: string | null;
};
export type Connection = {
  id: string;
  source: "simplefin" | "plaid";
  label: string;
  status: "active" | "error" | "revoked";
  last_attempted_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  created_at: string;
};
export type SourceSync = {
  id: string;
  connection_id: string;
  trigger: string;
  started_at: string;
  finished_at: string | null;
  status: "running" | "success" | "partial" | "failed";
  accounts_seen: number;
  transactions_added: number;
  window_start: string | null;
  window_end: string | null;
  messages: string[];
};
export type ImportRecord = {
  id: string;
  account_id: string;
  format: string;
  file_name: string;
  row_count: number;
  coverage_start: string | null;
  coverage_end: string | null;
  created_at: string;
};
export type CardArt = {
  card_id: string;
  sha256: string;
  origin: "issuer" | "upload";
  bands: { x: number; y: number; w: number; h: number; color: string }[];
  overlay: boolean;
  updated_at: string;
};
export type Snapshot = {
  cardArt: CardArt[];
  accounts: Account[];
  connections: Connection[];
  syncs: SourceSync[];
  imports: ImportRecord[];
  cards: Card[];
  benefits: Benefit[];
  periods: Period[];
  evidence: Evidence[];
  runs: SyncRun[];
  audit: AuditEvent[];
  acknowledgements: Acknowledgement[];
  settings: UserSettings;
  periodErrors: string[];
};
export type { Json };
