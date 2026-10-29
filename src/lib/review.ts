import type { Alert } from "./alerts";
import type {
  Account,
  Benefit,
  Card,
  Evidence,
  Period,
  Snapshot,
} from "./types";
import { enrollmentUnknown, rowStatus } from "./benefit-status";
import { accountFreshness, localDate } from "./domain";

// The Review tab asks only what PerkKeep cannot decide alone (rule 8), in three sections:
// purchases that may be a benefit, windows ending soon with no evidence, and enrollment.
// Benefits whose coverage is stale are not items; they are named under one note per card.
export type ReviewQueue = {
  candidates: { alert: Alert; evidence: Evidence; period: Period }[];
  endingSoon: { alert: Alert; period: Period | null }[];
  stale: { card: Card; count: number; accounts: Account[] }[];
  enrollment: { card: Card; benefits: Benefit[] }[];
  count: number;
};
export function reviewQueue(
  data: Snapshot,
  alerts: Alert[],
  now = new Date(),
): ReviewQueue {
  const periods = new Map(data.periods.map((p) => [p.id, p])),
    evidence = new Map(data.evidence.map((e) => [e.id, e])),
    cards = data.cards.filter(
      (c) => !c.archived_at && c.status === "active" && c.identity_verified_at,
    );
  const candidates = alerts
    .filter((a) => a.kind === "candidate")
    .map((alert) => ({
      alert,
      evidence: evidence.get(alert.evidenceId ?? "")!,
      period: periods.get(alert.periodId ?? "")!,
    }))
    .filter((c) => c.evidence && c.period);
  const expiring = alerts.filter((a) => a.kind === "expiring");
  const endingSoon: ReviewQueue["endingSoon"] = [],
    staleCards = new Map<string, number>();
  for (const alert of expiring) {
    const period = alert.periodId ? periods.get(alert.periodId) : undefined;
    // A membership's alert has no period: activate it or note that it ends.
    if (!alert.periodId) {
      endingSoon.push({ alert, period: null });
      continue;
    }
    if (!period) continue;
    const s = rowStatus(period, now);
    if (s === "unknown")
      staleCards.set(period.card_id, (staleCards.get(period.card_id) ?? 0) + 1);
    else if (
      s === "available" &&
      period.confirmed_cents === 0 &&
      period.confirmed_units === 0
    )
      endingSoon.push({ alert, period });
  }
  const stale = cards
    .filter((c) => staleCards.has(c.id))
    .map((card) => ({
      card,
      count: staleCards.get(card.id)!,
      accounts: data.accounts.filter(
        (a) => a.card_id === card.id && a.mapping_status === "confirmed",
      ),
    }));
  const enrollment = cards
    .map((card) => {
      const day = localDate(now, card.issuer_timezone);
      return {
        card,
        benefits: data.benefits.filter(
          (b) =>
            b.card_id === card.id &&
            b.enabled &&
            b.effective_from <= day &&
            (!b.effective_to || b.effective_to > day) &&
            enrollmentUnknown(b),
        ),
      };
    })
    .filter((e) => e.benefits.length);
  return {
    candidates,
    endingSoon,
    stale,
    enrollment,
    count: candidates.length + endingSoon.length + enrollment.length,
  };
}

// The one-line note for a card whose ending benefits cannot be judged (rule 8).
export function staleNote(s: ReviewQueue["stale"][number], now = new Date()) {
  const n = `${s.card.display_name}’s ${s.count} ${s.count === 1 ? "benefit is" : "benefits are"} not listed`;
  if (!s.accounts.length)
    return `${n}: no synced account covers this card, so PerkKeep cannot tell.`;
  const through = s.accounts
    .map((a) => a.synced_through)
    .filter((d): d is string => !!d)
    .sort()[0];
  const failing = s.accounts.some(
    (a) => accountFreshness(a, now) !== "current",
  );
  return `${n}: ${failing ? "its sync stopped" : "its transactions are synced only"}${through ? ` through ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${through}T12:00:00Z`))}` : ""}, so PerkKeep cannot tell.`;
}
