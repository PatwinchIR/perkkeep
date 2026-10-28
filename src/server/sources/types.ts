// Normalized shapes every source adapter produces. Amounts are integer cents; positive means money
// into the account (a credit card payment or statement credit), negative means money out (a purchase).
export type SourceAccount = {
  externalId: string;
  institution: string;
  name: string;
  mask: string | null;
  kind: "credit" | "depository" | "investment" | "loan" | "other" | "unknown";
  currency: string;
  balanceCents: number | null;
  availableCents: number | null;
  balanceObservedAt: string | null;
  error: string | null;
};
export type SourceTransaction = {
  accountExternalId: string;
  externalId: string;
  transactedOn: string;
  postedOn: string | null;
  amountCents: number;
  description: string;
  pending: boolean;
  removed?: boolean;
};
export type SourceBatch = {
  accounts: SourceAccount[];
  transactions: SourceTransaction[];
  // Source-reported problems, safe to show the owner (no credentials or raw payloads).
  messages: string[];
  // True when the source reports explicit removals (Plaid), so absence never implies removal.
  explicitRemovals: boolean;
  // Updated connection state to store, encrypted, after a successful sync (Plaid's cursor).
  nextSecret?: string;
};
export type SyncWindow = { start: string; endExclusive: string };

export interface SourceAdapter {
  readonly source: "simplefin" | "plaid";
  fetch(secret: string, window: SyncWindow): Promise<SourceBatch>;
}

// Parses a decimal string such as "-12.30" into integer cents without floating-point rounding.
export function decimalToCents(value: string | number): number {
  const text = String(value).trim();
  const match = text.match(/^([+-])?(\d*)(?:\.(\d*))?$/);
  if (!match || (!match[2] && !match[3]))
    throw new Error(`Not a decimal amount: ${text.slice(0, 20)}`);
  const sign = match[1] === "-" ? -1 : 1;
  const whole = Number(match[2] || "0");
  const frac = (match[3] ?? "").padEnd(3, "0");
  // Round half away from zero on the third decimal.
  let cents = whole * 100 + Number(frac.slice(0, 2));
  if (Number(frac[2]) >= 5) cents += 1;
  if (!Number.isSafeInteger(cents)) throw new Error("Amount out of range");
  return sign * cents || 0;
}
