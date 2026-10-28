import type {
  Account,
  Benefit,
  Card,
  Evidence,
  Period,
  Snapshot,
} from "./types";
import { ruleById, type BenefitRule } from "./catalog";
import {
  accountFreshness,
  activePeriod,
  coverageFresh,
  dateLabel,
  eligible,
  localDate,
  money,
  periodLabel,
  shiftDays,
  status,
  CADENCES,
} from "./domain";

// Alerts are derived from the ledger on every load and never stored, so an alert can never
// disagree with a balance. A dismissible alert is hidden by an acknowledgement of its key; the
// key changes when the underlying fact changes, so the alert returns on its own.
export type AlertKind =
  | "setup"
  | "account_link"
  | "terms_changed"
  | "allowance_needed"
  | "candidate"
  | "expiring"
  | "reverify"
  | "sync_failing"
  | "coverage_stale"
  | "no_period"
  | "completed"
  | "used";
export type AlertGroup = "attention" | "activity";
export type Alert = {
  key: string;
  kind: AlertKind;
  group: AlertGroup;
  title: string;
  detail: string;
  href: string;
  cardId: string | null;
  benefitId: string | null;
  periodId: string | null;
  evidenceId: string | null;
  dismissible: boolean;
  occurredAt: string | null;
  context: Record<string, unknown>;
};
export const ALERT_LABELS: Record<AlertKind, string> = {
  setup: "Card setup",
  account_link: "Account link",
  terms_changed: "Terms changed",
  allowance_needed: "Allowance needed",
  candidate: "Possible use",
  expiring: "Ending soon",
  reverify: "Re-check terms",
  sync_failing: "Sync",
  coverage_stale: "Coverage",
  no_period: "Period setup",
  completed: "Fully used",
  used: "Used",
};
const ATTENTION_ORDER: AlertKind[] = [
  "setup",
  "account_link",
  "terms_changed",
  "allowance_needed",
  "candidate",
  "expiring",
  "reverify",
  "sync_failing",
  "no_period",
  "coverage_stale",
];
// Days after the last verification before the owner is asked to re-read the issuer's terms.
export const REVIEW_AFTER_DAYS = 180;
export type Progress = {
  unit: "cents" | "units";
  unitLabel: string;
  allowance: number | null;
  confirmed: number;
  candidate: number;
  remaining: number | null;
  trusted: boolean;
  daysTotal: number;
  daysLeft: number;
  elapsedFraction: number;
  confirmedFraction: number | null;
  candidateFraction: number | null;
  partialWindow: boolean;
};
export type AlertInput = {
  data: Snapshot;
  leadDays: number;
  acknowledged: Iterable<string>;
  now?: Date;
  activityDays?: number;
  lookup?: (id: string | null | undefined) => BenefitRule | undefined;
};
export function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`).getTime(),
    b = new Date(`${to}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86400000);
}
function snapshotOf(p: Period): Record<string, unknown> {
  const s = p.rule_snapshot;
  return typeof s === "object" && s !== null && !Array.isArray(s)
    ? (s as Record<string, unknown>)
    : {};
}
export function isUnits(p: Period): boolean {
  return p.allowance_units !== null || snapshotOf(p).nominal_units != null;
}
export function unitLabelOf(p: Period): string {
  return String(snapshotOf(p).unit_label ?? "units");
}
export function formatAmount(p: Period, n: number | null): string {
  if (!isUnits(p)) return money(n);
  return n === null ? "Not established" : `${n} ${unitLabelOf(p)}`;
}
// The catalog rule a benefit was created from, recorded in eligibility_rules_json.
export function catalogLink(b: Benefit): {
  id: string | null;
  version: string | null;
} {
  const j = b.eligibility_rules_json as {
    catalog_rule_id?: unknown;
    catalog_rule_version?: unknown;
  };
  return {
    id: typeof j?.catalog_rule_id === "string" ? j.catalog_rule_id : null,
    version:
      typeof j?.catalog_rule_version === "string"
        ? j.catalog_rule_version
        : null,
  };
}
// Trusted means eligibility, enrollment, coverage freshness and unresolved evidence all check out.
export function trusted(p: Period, now = new Date()): boolean {
  return (
    eligible(p) &&
    coverageFresh(p, now) &&
    !p.negative_balance &&
    p.unresolved_count === 0
  );
}
export function progress(p: Period, now = new Date()): Progress {
  const units = isUnits(p),
    allowance = units ? p.allowance_units : p.allowance_cents,
    confirmed = units ? p.confirmed_units : p.confirmed_cents,
    candidate = units ? p.candidate_units : p.candidate_cents,
    remaining = units ? p.remaining_units : p.remaining_cents,
    day = localDate(now, p.issuer_timezone),
    daysTotal = Math.max(
      1,
      daysBetween(p.period_start, p.period_end_exclusive),
    ),
    daysLeft = Math.min(
      daysTotal,
      Math.max(0, daysBetween(day, p.period_end_exclusive)),
    ),
    fraction = (n: number) =>
      allowance !== null && allowance > 0 ? Math.min(1, n / allowance) : null,
    confirmedFraction = fraction(confirmed);
  return {
    unit: units ? "units" : "cents",
    unitLabel: units ? unitLabelOf(p) : "",
    allowance,
    confirmed,
    candidate,
    remaining,
    trusted: trusted(p, now),
    daysTotal,
    daysLeft,
    elapsedFraction: Math.min(
      1,
      Math.max(0, (daysTotal - daysLeft) / daysTotal),
    ),
    confirmedFraction,
    candidateFraction:
      confirmedFraction === null
        ? null
        : Math.min(1 - confirmedFraction, fraction(candidate) ?? 0),
    partialWindow: snapshotOf(p).partial_rule_window === true,
  };
}
// Deterministic short digest so aggregate alert keys stay within the stored key length.
export function digest(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++)
    h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}
const cadenceLabel = (c: string) => CADENCES[c as keyof typeof CADENCES] ?? c;
export function termsDifferences(b: Benefit, rule: BenefitRule): string[] {
  const out: string[] = [];
  if (b.name !== rule.name) out.push(`Name “${b.name}” → “${rule.name}”`);
  if (b.cadence !== rule.period)
    out.push(`Reset ${cadenceLabel(b.cadence)} → ${cadenceLabel(rule.period)}`);
  const cents = rule.amount_cents ?? null,
    units = rule.units ?? null;
  if (b.nominal_amount_cents !== cents)
    out.push(`Allowance ${money(b.nominal_amount_cents)} → ${money(cents)}`);
  if (b.nominal_units !== units)
    out.push(
      `Units ${b.nominal_units ?? "none"} → ${units ?? "none"}${rule.unit_label ? ` ${rule.unit_label}` : ""}`,
    );
  if (b.enrollment_required !== rule.enrollment_required)
    out.push(
      rule.enrollment_required
        ? "Enrollment now required"
        : "Enrollment no longer required",
    );
  if (b.manual_verification_required !== rule.manual)
    out.push(
      rule.manual
        ? "Use must now be verified outside statements"
        : "Statement evidence now sufficient",
    );
  if (rule.effective_to && b.effective_to !== rule.effective_to)
    out.push(`Issuer end date ${dateLabel(shiftDays(rule.effective_to, -1))}`);
  if (b.issuer_source_url !== rule.source_url)
    out.push("Issuer source URL changed");
  return out;
}
function latest(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}
export function liveEvidence(evidence: Evidence[]): Evidence[] {
  const superseded = new Set(
    evidence.map((e) => e.supersedes_evidence_id).filter(Boolean),
  );
  return evidence.filter((e) => !superseded.has(e.id));
}
const base = {
  cardId: null,
  benefitId: null,
  periodId: null,
  evidenceId: null,
  occurredAt: null,
  context: {},
} as const;

export function deriveAlerts(input: AlertInput): Alert[] {
  const now = input.now ?? new Date(),
    activityDays = input.activityDays ?? 30,
    lookup = input.lookup ?? ruleById,
    acknowledged = new Set(input.acknowledged),
    { data, leadDays } = input,
    cards = new Map<string, Card>(data.cards.map((c) => [c.id, c])),
    benefits = new Map<string, Benefit>(data.benefits.map((b) => [b.id, b])),
    periods = new Map<string, Period>(data.periods.map((p) => [p.id, p])),
    live = liveEvidence(data.evidence),
    alerts: Alert[] = [];
  const dayFor = (tz?: string | null) => localDate(now, tz ?? undefined);
  const archived = (p: Period) => !!cards.get(p.card_id)?.archived_at;
  const active = data.periods.filter(
    (p) =>
      activePeriod(p, benefits.get(p.benefit_id), now) &&
      p.enabled &&
      p.card_status === "active" &&
      !archived(p),
  );
  const recentCutoff = new Date(
    now.getTime() - activityDays * 86400000,
  ).toISOString();
  const push = (a: Alert) => {
    if (!(a.dismissible && acknowledged.has(a.key))) alerts.push(a);
  };

  for (const card of data.cards)
    if (!card.identity_verified_at && !card.archived_at)
      push({
        ...base,
        key: `setup:${card.id}`,
        kind: "setup",
        group: "attention",
        title: `Confirm ${card.display_name}`,
        detail: card.product_name
          ? "Confirm this card’s identity and status before its benefits are tracked."
          : "Identify this card’s product, then confirm its identity.",
        href: `/cards/${card.id}`,
        cardId: card.id,
        dismissible: false,
      });

  for (const a of data.accounts as Account[])
    if (
      a.kind === "credit" &&
      (a.mapping_status === "unmapped" || a.mapping_status === "proposed")
    )
      push({
        ...base,
        key: `account:${a.id}:${a.mapping_status}`,
        kind: "account_link",
        group: "attention",
        title: `Link ${a.institution ? `${a.institution} ` : ""}${a.name}`,
        detail:
          "This synced card account is not linked to a card yet, so its transactions cannot show benefit use.",
        href: "/settings",
        dismissible: true,
        context: { account_id: a.id },
      });

  for (const b of data.benefits) {
    const card = cards.get(b.card_id);
    if (!card || !b.enabled || card.status !== "active" || card.archived_at)
      continue;
    const day = dayFor(card.issuer_timezone);
    if (b.effective_from > day || (b.effective_to && b.effective_to <= day))
      continue;
    const link = catalogLink(b),
      rule = link.id ? lookup(link.id) : undefined;
    if (link.id && !rule)
      push({
        ...base,
        key: `terms:${b.id}:retired`,
        kind: "terms_changed",
        group: "attention",
        title: `Rule file retired: ${b.name}`,
        detail:
          "The researched rule behind this benefit is no longer in the rule files. Verify current terms with the issuer.",
        href: `/cards/${b.card_id}`,
        cardId: b.card_id,
        benefitId: b.id,
        dismissible: true,
        context: { rule_id: link.id },
      });
    else if (rule && link.version && rule.version > link.version) {
      const changes = termsDifferences(b, rule);
      push({
        ...base,
        key: `terms:${b.id}:${rule.version}`,
        kind: "terms_changed",
        group: "attention",
        title: `Terms may have changed: ${b.name}`,
        detail: `${changes.length ? changes.join("; ") + ". " : ""}The rule file was re-read on ${dateLabel(rule.version)}. Review the issuer’s page, then save a new version or keep the current terms.`,
        href: `/cards/${b.card_id}`,
        cardId: b.card_id,
        benefitId: b.id,
        dismissible: true,
        context: {
          rule_id: rule.id,
          from_version: link.version,
          to_version: rule.version,
          changes,
        },
      });
    } else if (
      rule?.effective_to &&
      rule.effective_to <= day &&
      (!b.effective_to || b.effective_to > rule.effective_to)
    )
      push({
        ...base,
        key: `terms:${b.id}:ended:${rule.effective_to}`,
        kind: "terms_changed",
        group: "attention",
        title: `Issuer ended this benefit: ${b.name}`,
        detail: `The rule file records an end date of ${dateLabel(shiftDays(rule.effective_to, -1))}. Confirm with the issuer, then end or pause the rule.`,
        href: `/cards/${b.card_id}`,
        cardId: b.card_id,
        benefitId: b.id,
        dismissible: true,
        context: { rule_id: rule.id, effective_to: rule.effective_to },
      });
    const anchor = latest(b.verified_at, b.last_reverified_at);
    if (
      anchor &&
      card.identity_verified_at &&
      new Date(anchor).getTime() + REVIEW_AFTER_DAYS * 86400000 <= now.getTime()
    )
      push({
        ...base,
        key: `reverify:${b.id}:${anchor.slice(0, 10)}`,
        kind: "reverify",
        group: "attention",
        title: `Re-check terms: ${b.name}`,
        detail: `Last verified ${dateLabel(anchor.slice(0, 10))}, more than ${REVIEW_AFTER_DAYS} days ago. Open the issuer’s page, then mark the terms unchanged or save a new version.`,
        href: `/cards/${b.card_id}`,
        cardId: b.card_id,
        benefitId: b.id,
        dismissible: false,
        context: { verified: anchor },
      });
  }

  const stale: Period[] = [];
  for (const p of active) {
    const pr = progress(p, now);
    if (pr.allowance === null && pr.partialWindow)
      push({
        ...base,
        key: `allowance:${p.id}`,
        kind: "allowance_needed",
        group: "attention",
        title: `Confirm the allowance: ${p.benefit_name}`,
        detail: `${periodLabel(p)} starts inside new terms. Enter the allowance your issuer applies to this window; Perkkeep never prorates.`,
        href: `/cards/${p.card_id}`,
        cardId: p.card_id,
        benefitId: p.benefit_id,
        periodId: p.id,
        dismissible: false,
      });
    if (
      pr.allowance !== null &&
      eligible(p) &&
      pr.remaining !== null &&
      pr.remaining > 0 &&
      p.period_end_exclusive <= shiftDays(dayFor(p.issuer_timezone), leadDays)
    ) {
      const fresh = coverageFresh(p, now);
      push({
        ...base,
        key: `expiring:${p.id}`,
        kind: "expiring",
        group: "attention",
        title: `${formatAmount(p, pr.remaining)} ${fresh ? "known available" : "not yet confirmed used"}: ${p.benefit_name}`,
        detail: `Ends ${dateLabel(shiftDays(p.period_end_exclusive, -1))}, ${pr.daysLeft === 0 ? "today" : `${pr.daysLeft} ${pr.daysLeft === 1 ? "day" : "days"} left`}.${fresh ? "" : " Coverage is not fresh, so this may already be used."}`,
        href: `/cards/${p.card_id}`,
        cardId: p.card_id,
        benefitId: p.benefit_id,
        periodId: p.id,
        dismissible: true,
        context: { remaining: pr.remaining, days_left: pr.daysLeft },
      });
    }
    if (pr.allowance !== null && eligible(p) && !coverageFresh(p, now))
      stale.push(p);
  }
  const candidateWindow = shiftDays(dayFor(), -45);
  for (const e of live) {
    const p = periods.get(e.benefit_period_id);
    if (!p || !p.enabled || p.card_status !== "active" || archived(p)) continue;
    if (
      e.confidence === "candidate" &&
      p.period_end_exclusive > candidateWindow
    )
      push({
        ...base,
        key: `candidate:${e.id}`,
        kind: "candidate",
        group: "attention",
        title: `Possible use of ${p.benefit_name}: ${formatAmount(p, isUnits(p) ? e.units : e.amount_cents)}`,
        detail: `${e.merchant ?? e.source_type.replaceAll("_", " ")} on ${dateLabel(e.transaction_date)}. Look for issuer confirmation, then confirm or reject.`,
        href: "/review",
        cardId: p.card_id,
        benefitId: p.benefit_id,
        periodId: p.id,
        evidenceId: e.id,
        dismissible: false,
        occurredAt: e.recorded_at,
      });
    if (e.confidence === "confirmed" && e.recorded_at >= recentCutoff) {
      const n = isUnits(p) ? e.units : e.amount_cents,
        reversal = ["refund", "reversal"].includes(e.source_type);
      push({
        ...base,
        key: `used:${e.id}`,
        kind: "used",
        group: "activity",
        title: `${reversal ? "Reversal of" : "Used"} ${formatAmount(p, Math.abs(n ?? 0))}: ${p.benefit_name}`,
        detail: `${e.merchant ?? e.source_type.replaceAll("_", " ")} on ${dateLabel(e.transaction_date)} · ${e.recorded_by === "user" ? "entered by you" : "matched from your statement"} · ${periodLabel(p)}`,
        href: `/cards/${p.card_id}`,
        cardId: p.card_id,
        benefitId: p.benefit_id,
        periodId: p.id,
        evidenceId: e.id,
        dismissible: true,
        occurredAt: e.recorded_at,
        context: { amount: n, source_type: e.source_type },
      });
    }
  }
  for (const p of data.periods) {
    if (
      !p.enabled ||
      p.card_status !== "active" ||
      archived(p) ||
      !fullyUsed(p)
    )
      continue;
    const confirmedAt = live
      .filter(
        (e) => e.benefit_period_id === p.id && e.confidence === "confirmed",
      )
      .map((e) => e.recorded_at)
      .sort()
      .at(-1);
    if (!confirmedAt || confirmedAt < recentCutoff) continue;
    push({
      ...base,
      key: `completed:${p.id}`,
      kind: "completed",
      group: "activity",
      title: `${p.benefit_name} fully used`,
      detail: `${formatAmount(p, isUnits(p) ? p.confirmed_units : p.confirmed_cents)} confirmed for ${periodLabel(p)}.`,
      href: "/history",
      cardId: p.card_id,
      benefitId: p.benefit_id,
      periodId: p.id,
      dismissible: true,
      occurredAt: confirmedAt,
    });
  }
  for (const message of data.periodErrors)
    push({
      ...base,
      key: `period:${digest(message)}`,
      kind: "no_period",
      group: "attention",
      title: "A benefit has no current period",
      detail: message,
      href: "/cards",
      dismissible: false,
      context: { message },
    });
  const failing = (data.accounts as Account[]).filter(
    (a) =>
      a.mapping_status === "confirmed" &&
      ["failing", "stale"].includes(accountFreshness(a, now)),
  );
  if (failing.length)
    push({
      ...base,
      key: `sync:${digest(
        failing
          .map(
            (a) => `${a.id}:${a.last_attempted_at ?? ""}:${a.last_error ?? ""}`,
          )
          .sort()
          .join("|"),
      )}`,
      kind: "sync_failing",
      group: "attention",
      title: `${failing.length} linked ${failing.length === 1 ? "account is" : "accounts are"} stale or failing`,
      detail:
        "Transactions on these accounts have not synced recently, so new use may be missing. Check the connection in Settings.",
      href: "/settings",
      dismissible: true,
      context: { account_ids: failing.map((a) => a.id) },
    });
  if (stale.length)
    push({
      ...base,
      key: `coverage:${digest(
        stale
          .map(
            (p) =>
              `${p.id}:${p.coverage_through ?? ""}:${p.last_reconciled_at ?? ""}`,
          )
          .sort()
          .join("|"),
      )}`,
      kind: "coverage_stale",
      group: "attention",
      title: `Coverage not fresh for ${stale.length} ${stale.length === 1 ? "benefit" : "benefits"}`,
      detail:
        "Remaining balances cannot be trusted until a sync or a manual reconciliation covers these periods. Missing coverage never counts as unused.",
      href: "/settings",
      dismissible: true,
      context: { period_ids: stale.map((p) => p.id) },
    });
  return sortAlerts(alerts);
}
function fullyUsed(p: Period): boolean {
  const allowance = isUnits(p) ? p.allowance_units : p.allowance_cents,
    used = isUnits(p) ? p.confirmed_units : p.confirmed_cents;
  return allowance !== null && allowance > 0 && used >= allowance;
}
export function sortAlerts(alerts: Alert[]): Alert[] {
  return [...alerts].sort((a, b) => {
    if (a.group !== b.group) return a.group === "attention" ? -1 : 1;
    if (a.group === "activity")
      return (b.occurredAt ?? "").localeCompare(a.occurredAt ?? "");
    const order =
      ATTENTION_ORDER.indexOf(a.kind) - ATTENTION_ORDER.indexOf(b.kind);
    return order || a.title.localeCompare(b.title);
  });
}
export const attention = (alerts: Alert[]) =>
  alerts.filter((a) => a.group === "attention");
export const activity = (alerts: Alert[]) =>
  alerts.filter((a) => a.group === "activity");
// Rows for the overview and card pages: every current period, grouped by reset timeframe and
// ordered by how soon the window ends, then by remaining value.
export const CADENCE_ORDER = [
  "monthly",
  "quarterly",
  "semiannual",
  "calendar_year",
  "cardmember_year",
  "one_time",
  "custom",
] as const;
export function groupByCadence(periods: Period[], now = new Date()) {
  const groups = new Map<string, Period[]>();
  for (const p of periods) {
    const list = groups.get(p.cadence) ?? [];
    list.push(p);
    groups.set(p.cadence, list);
  }
  return CADENCE_ORDER.filter((c) => groups.has(c)).map((cadence) => {
    const list = groups.get(cadence)!.sort((a, b) => {
      const da = progress(a, now).daysLeft,
        db = progress(b, now).daysLeft;
      return (
        da - db ||
        (b.remaining_cents ?? 0) - (a.remaining_cents ?? 0) ||
        a.benefit_name.localeCompare(b.benefit_name)
      );
    });
    const cents = list.filter((p) => !isUnits(p));
    return {
      cadence,
      label: cadenceLabel(cadence),
      periods: list,
      allowanceCents: cents.reduce((n, p) => n + (p.allowance_cents ?? 0), 0),
      confirmedCents: cents.reduce((n, p) => n + p.confirmed_cents, 0),
      remainingCents: cents.reduce((n, p) => n + (p.remaining_cents ?? 0), 0),
      unknownAllowance: cents.some((p) => p.allowance_cents === null),
      endsOn: list.map((p) => p.period_end_exclusive).sort()[0],
      statusCount: list.filter((p) =>
        ["needs_review", "candidate"].includes(status(p, now)),
      ).length,
    };
  });
}
