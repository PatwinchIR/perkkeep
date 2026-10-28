import type { Account, Benefit, Period } from "./types";
export const CADENCES = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  semiannual: "Half-yearly",
  calendar_year: "Calendar year",
  cardmember_year: "Cardmember year",
  one_time: "One-time",
  custom: "Custom dates",
} as const;
export function localDate(
  now = new Date(),
  timeZone = "America/New_York",
): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  return `${parts.find((p) => p.type === "year")!.value}-${parts.find((p) => p.type === "month")!.value}-${parts.find((p) => p.type === "day")!.value}`;
}
export function shiftDays(day: string, days: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function money(cents: number | null): string {
  return cents === null
    ? "Not established"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
      }).format(cents / 100);
}
export function dateLabel(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}
export function periodLabel(
  p: Pick<Period, "period_start" | "period_end_exclusive">,
): string {
  return `${dateLabel(p.period_start)} – ${dateLabel(shiftDays(p.period_end_exclusive, -1))}`;
}
export function activePeriod(
  p: Period,
  b?: Benefit,
  now = new Date(),
): boolean {
  const day = localDate(now, p.issuer_timezone);
  return (
    p.period_start <= day &&
    p.period_end_exclusive > day &&
    (!b?.effective_to || day < b.effective_to)
  );
}
export function eligible(p: Period): boolean {
  return (
    !!p.identity_verified_at &&
    p.card_status === "active" &&
    p.enabled &&
    p.eligibility_status === "eligible" &&
    (!p.enrollment_required || p.enrollment_status === "active")
  );
}
export function coverageFresh(p: Period, now = new Date()): boolean {
  return (
    p.coverage_status === "complete" &&
    !!p.last_reconciled_at &&
    !!p.coverage_through &&
    new Date(p.last_reconciled_at).getTime() <= now.getTime() + 60000 &&
    now.getTime() - new Date(p.last_reconciled_at).getTime() <= 7 * 86400000 &&
    p.coverage_through >= shiftDays(localDate(now, p.issuer_timezone), -7)
  );
}
export function knownAvailable(p: Period, now = new Date()): number | null {
  return eligible(p) &&
    coverageFresh(p, now) &&
    !p.negative_balance &&
    p.unresolved_count === 0
    ? p.remaining_cents
    : null;
}
export type BenefitStatus =
  | "unused"
  | "candidate"
  | "partially_confirmed"
  | "confirmed"
  | "expired"
  | "needs_review";
export function status(p: Period, now = new Date()): BenefitStatus {
  if (p.period_end_exclusive <= localDate(now, p.issuer_timezone))
    return "expired";
  if (
    !eligible(p) ||
    p.negative_balance ||
    p.unresolved_count > 0 ||
    (p.allowance_cents === null && p.allowance_units === null)
  )
    return "needs_review";
  const allowance = p.allowance_cents ?? p.allowance_units!;
  const used =
    p.allowance_cents === null ? p.confirmed_units : p.confirmed_cents;
  if (used >= allowance && allowance > 0) return "confirmed";
  if (p.candidate_cents > 0 || p.candidate_units > 0) return "candidate";
  if (used > 0) return "partially_confirmed";
  return coverageFresh(p, now) ? "unused" : "needs_review";
}
export const STATUS_LABELS: Record<BenefitStatus, string> = {
  unused: "Unused",
  candidate: "Potentially qualifying",
  partially_confirmed: "Partially confirmed",
  confirmed: "Confirmed",
  expired: "Expired",
  needs_review: "Needs review",
};
export function reviewReason(p: Period, now = new Date()): string {
  if (!p.identity_verified_at) return "Confirm this card’s identity.";
  if (p.eligibility_status !== "eligible")
    return "Confirm that this benefit applies to your card.";
  if (p.enrollment_required && p.enrollment_status !== "active")
    return "Confirm enrollment with your issuer.";
  if (p.allowance_cents === null && p.allowance_units === null)
    return "Allowance needs confirmation for this rule window.";
  if (p.negative_balance)
    return "Reversals exceed recorded confirmations. Review the evidence.";
  if (p.candidate_cents > 0 || p.candidate_units > 0)
    return "A purchase may qualify. Look for issuer confirmation.";
  if (!coverageFresh(p, now))
    return "Transaction coverage is missing, partial, or more than seven days old.";
  return "Review the supporting evidence.";
}
export function parseCents(value: string): number {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim()))
    throw new Error(
      "Enter a positive dollar amount with at most two decimal places.",
    );
  const [d, c = ""] = value.trim().split(".");
  const cents = Number(d) * 100 + Number(c.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents > 2147483647)
    throw new Error("Amount is too large.");
  return cents;
}
export function sortReview(a: Period, b: Period): number {
  return (
    a.period_end_exclusive.localeCompare(b.period_end_exclusive) ||
    (b.remaining_cents ?? 0) - (a.remaining_cents ?? 0)
  );
}

export function cardEnding(last4: string | null): string {
  return last4 ? `•••• ${last4}` : "Last four not set";
}

// SimpleFIN refreshes about once a day; two days without a successful sync is stale.
export function accountFreshness(
  a: Pick<Account, "last_success_at" | "last_error" | "source">,
  now = new Date(),
): "current" | "stale" | "failing" | "never" {
  if (a.last_error) return "failing";
  if (!a.last_success_at) return "never";
  if (a.source === "csv") return "current";
  return now.getTime() - Date.parse(a.last_success_at) > 48 * 3600 * 1000
    ? "stale"
    : "current";
}
