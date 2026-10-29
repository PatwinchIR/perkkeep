import type { Benefit, Period } from "./types";
import { CADENCES, coverageFresh, localDate, money, shiftDays } from "./domain";

// One status per benefit row (docs/design-benefits-page.md rule 2). Allowance rows get exactly one
// of Available, Used, Unknown, Not enrolled or Review; memberships get Active or Not activated.
// Unknown enrollment is not a status: it is a question for the card's enrollment checklist.
export type RowStatus =
  | "available"
  | "used"
  | "unknown"
  | "not_enrolled"
  | "review"
  | "active"
  | "not_activated";
export const ROW_STATUS_LABELS: Record<RowStatus, string> = {
  available: "Available",
  used: "Used",
  unknown: "Unknown",
  not_enrolled: "Not enrolled",
  review: "Review",
  active: "Active",
  not_activated: "Not activated",
};

type Enrollment = Pick<
  Benefit,
  "enrollment_required" | "enrollment_status" | "eligibility_status"
>;
// A rule with neither an amount nor units is a membership (rule 11). Rows from before migration
// 0006 have no kind and are allowances.
export function isMembership(
  b: Pick<Benefit, "kind"> | null | undefined,
): boolean {
  return b?.kind === "membership";
}
// The owner said they are not enrolled, or that the benefit does not apply to the card.
export function notEnrolled(b: Enrollment): boolean {
  return (
    (b.enrollment_required && b.enrollment_status === "inactive") ||
    b.eligibility_status === "ineligible"
  );
}
export function enrollmentUnknown(
  b: Pick<Benefit, "enrollment_required" | "enrollment_status">,
): boolean {
  return b.enrollment_required && b.enrollment_status === "unknown";
}

function units(p: Period): boolean {
  const s = p.rule_snapshot as Record<string, unknown> | null;
  return p.allowance_units !== null || s?.nominal_units != null;
}
export function figures(p: Period) {
  const u = units(p);
  return {
    allowance: u ? p.allowance_units : p.allowance_cents,
    confirmed: u ? p.confirmed_units : p.confirmed_cents,
    candidate: u ? p.candidate_units : p.candidate_cents,
    remaining: u ? p.remaining_units : p.remaining_cents,
  };
}

export function rowStatus(p: Period, now = new Date()): RowStatus {
  if (notEnrolled(p)) return "not_enrolled";
  const f = figures(p);
  if (f.candidate > 0) return "review";
  if (f.allowance !== null && f.allowance > 0 && f.confirmed >= f.allowance)
    return "used";
  if (
    f.allowance === null ||
    !coverageFresh(p, now) ||
    p.unresolved_count > 0 ||
    p.negative_balance
  )
    return "unknown";
  return "available";
}

// The last day a membership runs: the end of its activation window or the benefit's end date.
export function membershipThrough(
  b: Pick<Benefit, "custom_end_exclusive" | "effective_to">,
): string | null {
  const ends = [b.custom_end_exclusive, b.effective_to].filter(
    (d): d is string => !!d,
  );
  return ends.length ? shiftDays(ends.sort()[0], -1) : null;
}
export function membershipStatus(
  b: Pick<
    Benefit,
    | "enrollment_required"
    | "enrollment_status"
    | "eligibility_status"
    | "activated_on"
  >,
  today: string,
): "active" | "not_activated" {
  return notEnrolled(b) || !b.activated_on || b.activated_on > today
    ? "not_activated"
    : "active";
}

const weekday = (d: string) =>
  new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: "UTC",
  }).format(new Date(`${d}T12:00:00Z`));
export const shortDate = (d: string, year = false) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(year ? { year: "numeric" } : {}),
    timeZone: "UTC",
  }).format(new Date(`${d}T12:00:00Z`));
// When a window ends, relative to today: "today", "tomorrow", a weekday within a week, else a date.
export function endsLabel(lastDay: string, today: string): string {
  if (lastDay <= today) return "today";
  if (lastDay === shiftDays(today, 1)) return "tomorrow";
  if (lastDay <= shiftDays(today, 6)) return weekday(lastDay);
  return shortDate(lastDay, lastDay.slice(0, 4) !== today.slice(0, 4));
}
export const lastDay = (p: Pick<Period, "period_end_exclusive">) =>
  shiftDays(p.period_end_exclusive, -1);

function amount(p: Period, n: number): string {
  if (!units(p)) return money(n);
  const s = p.rule_snapshot as Record<string, unknown> | null;
  return `${n} ${String(s?.unit_label ?? "units")}`;
}
// The right-hand figure of a row (rule 10): known amounts read "$35 left", unconfirmed ones "$35?",
// and "unconfirmed" is never an amount.
export function amountText(p: Period, s: RowStatus): string {
  const f = figures(p);
  if (s === "not_enrolled") return ROW_STATUS_LABELS.not_enrolled;
  if (s === "used" && f.allowance !== null)
    return `${amount(p, f.confirmed)} of ${amount(p, f.allowance)}`;
  if (f.allowance === null || f.remaining === null) return "Unknown";
  if (s === "unknown") return `${amount(p, f.remaining)}?`;
  return `${amount(p, f.remaining)} left`;
}

// Rows of one reset timeframe (rules 6 and 7): ending soonest first, then by remaining amount,
// with Used and Not enrolled rows set apart to collapse at the end. Totals count neither
// memberships nor Not enrolled rows.
export type RowGroup = {
  cadence: string;
  label: string;
  rows: Period[];
  done: Period[];
  notEnrolled: Period[];
  allowanceCents: number;
  confirmedCents: number;
  endsOn: string | null;
};
const CADENCE_ORDER = Object.keys(CADENCES);
export function sortRows(a: Period, b: Period): number {
  return (
    a.period_end_exclusive.localeCompare(b.period_end_exclusive) ||
    (figures(b).remaining ?? 0) - (figures(a).remaining ?? 0) ||
    a.benefit_name.localeCompare(b.benefit_name)
  );
}
export function groupRows(periods: Period[], now = new Date()): RowGroup[] {
  const groups = new Map<string, Period[]>();
  for (const p of periods)
    groups.set(p.cadence, [...(groups.get(p.cadence) ?? []), p]);
  return CADENCE_ORDER.filter((c) => groups.has(c)).map((cadence) => {
    const list = [...groups.get(cadence)!].sort(sortRows),
      status = new Map(list.map((p) => [p.id, rowStatus(p, now)])),
      counted = list.filter(
        (p) => status.get(p.id) !== "not_enrolled" && !units(p),
      ),
      open = list.filter(
        (p) => !["used", "not_enrolled"].includes(status.get(p.id)!),
      );
    return {
      cadence,
      label: CADENCES[cadence as keyof typeof CADENCES],
      rows: open,
      done: list.filter((p) => status.get(p.id) === "used"),
      notEnrolled: list.filter((p) => status.get(p.id) === "not_enrolled"),
      allowanceCents: counted.reduce((n, p) => n + (p.allowance_cents ?? 0), 0),
      confirmedCents: counted.reduce((n, p) => n + p.confirmed_cents, 0),
      endsOn:
        list
          .filter((p) => status.get(p.id) !== "not_enrolled")
          .map((p) => lastDay(p))
          .sort()[0] ??
        list.map((p) => lastDay(p)).sort()[0] ??
        null,
    };
  });
}

// Home (step 5): open allowance rows across every card, grouped by the day their window ends.
export function expiryGroups(periods: Period[], now = new Date()) {
  const open = periods
    .filter((p) =>
      ["available", "unknown", "review"].includes(rowStatus(p, now)),
    )
    .sort(sortRows);
  const groups = new Map<string, Period[]>();
  for (const p of open)
    groups.set(lastDay(p), [...(groups.get(lastDay(p)) ?? []), p]);
  return [...groups.entries()].map(([day, rows]) => ({
    day,
    rows,
    cards: new Set(rows.map((p) => p.card_id)).size,
    remainingCents: rows
      .filter((p) => !units(p))
      .reduce((n, p) => n + (p.remaining_cents ?? 0), 0),
    known: rows.every((p) => rowStatus(p, now) === "available"),
  }));
}
// The heading of one Home group: "Ending Friday" within a week, otherwise "By Dec 31".
export function expiryHeading(day: string, today: string): string {
  if (day <= today) return "Ending today";
  if (day === shiftDays(today, 1)) return "Ending tomorrow";
  if (day <= shiftDays(today, 6))
    return `Ending ${new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`))}`;
  return `By ${shortDate(day, day.slice(0, 4) !== today.slice(0, 4))}`;
}
export const todayFor = (
  p: Pick<Period, "issuer_timezone">,
  now = new Date(),
) => localDate(now, p.issuer_timezone);
