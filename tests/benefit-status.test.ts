// Row status, membership rules and the Review queue on SYNTHETIC snapshots. No database.
import { describe, expect, it } from "vitest";
import {
  amountText,
  endsLabel,
  expiryGroups,
  expiryHeading,
  groupRows,
  membershipStatus,
  membershipThrough,
  rowStatus,
} from "../src/lib/benefit-status";
import { attention, deriveAlerts } from "../src/lib/alerts";
import { reviewQueue } from "../src/lib/review";
import { DEFAULT_SETTINGS } from "../src/lib/types";
import type {
  Benefit,
  Card,
  Evidence,
  Period,
  Snapshot,
} from "../src/lib/types";

const now = new Date("2026-10-28T15:00:00Z");
const daysAgo = (n: number) =>
  new Date(now.getTime() - n * 86400000).toISOString();
let seq = 0;
const id = (p: string) => `${p}-${++seq}`;

function card(extra: Partial<Card> = {}): Card {
  return {
    id: id("card"),
    owner_user_id: "owner",
    issuer: "Synthetic Issuer",
    display_name: "Synthetic card",
    product_name: "Synthetic Product",
    last4: null,
    status: "active",
    identity_verified_at: daysAgo(30),
    cardmember_anchor_date: null,
    issuer_timezone: "America/New_York",
    catalog_key: null,
    archived_at: null,
    created_at: daysAgo(30),
    updated_at: daysAgo(30),
    ...extra,
  };
}
function benefit(c: Card, extra: Partial<Benefit> = {}): Benefit {
  return {
    id: id("benefit"),
    owner_user_id: "owner",
    card_id: c.id,
    rule_key: id("rule"),
    name: "Synthetic allowance",
    description: "",
    category: "Other",
    cadence: "monthly",
    nominal_amount_cents: 3500,
    nominal_units: null,
    unit_label: null,
    reset_anchor: null,
    custom_end_exclusive: null,
    enrollment_required: false,
    enrollment_status: "not_required",
    eligibility_status: "eligible",
    manual_verification_required: false,
    eligibility_rules_json: {},
    effective_from: "2026-01-01",
    effective_to: null,
    issuer_source_url: "https://example.com/synthetic",
    verified_at: daysAgo(10),
    last_reverified_at: null,
    enabled: true,
    kind: "allowance",
    activated_on: null,
    activation_assumed: true,
    created_at: daysAgo(30),
    updated_at: daysAgo(30),
    ...extra,
  };
}
function period(c: Card, b: Benefit, extra: Partial<Period> = {}): Period {
  return {
    id: id("period"),
    owner_user_id: "owner",
    card_id: c.id,
    benefit_id: b.id,
    period_start: "2026-10-01",
    period_end_exclusive: "2026-11-01",
    allowance_cents: b.nominal_amount_cents,
    allowance_units: b.nominal_units,
    rule_snapshot: {
      nominal_amount_cents: b.nominal_amount_cents,
      nominal_units: b.nominal_units,
      partial_rule_window: false,
    },
    coverage_status: "complete",
    coverage_through: "2026-10-27",
    last_reconciled_at: daysAgo(1),
    notes: "",
    created_at: daysAgo(27),
    updated_at: daysAgo(1),
    benefit_name: b.name,
    cadence: b.cadence,
    enrollment_required: b.enrollment_required,
    enrollment_status: b.enrollment_status,
    eligibility_status: b.eligibility_status,
    enabled: b.enabled,
    card_name: c.display_name,
    last4: c.last4,
    issuer: c.issuer,
    issuer_timezone: c.issuer_timezone,
    card_status: c.status,
    identity_verified_at: c.identity_verified_at,
    confirmed_cents: 0,
    candidate_cents: 0,
    confirmed_units: 0,
    candidate_units: 0,
    remaining_cents: b.nominal_amount_cents,
    remaining_units: b.nominal_units,
    unresolved_count: 0,
    negative_balance: false,
    ...extra,
  };
}
function snapshot(extra: Partial<Snapshot>): Snapshot {
  return {
    cardArt: [],
    accounts: [],
    connections: [],
    syncs: [],
    imports: [],
    cards: [],
    benefits: [],
    periods: [],
    evidence: [],
    runs: [],
    audit: [],
    acknowledgements: [],
    settings: DEFAULT_SETTINGS,
    pendingMigration: null,
    periodErrors: [],
    ...extra,
  };
}
function candidate(p: Period, cents: number): Evidence {
  return {
    id: id("evidence"),
    owner_user_id: "owner",
    card_id: p.card_id,
    benefit_period_id: p.id,
    source_type: "purchase",
    source_reference_hash: null,
    transaction_date: "2026-10-20",
    merchant: "Synthetic Merchant",
    amount_cents: cents,
    units: null,
    eligibility_result: "eligible",
    confirmation_result: "",
    confidence: "candidate",
    notes: "",
    recorded_at: daysAgo(2),
    recorded_by: "import",
    supersedes_evidence_id: null,
  };
}

describe("rowStatus: exactly one status per allowance row (rule 2)", () => {
  const c = card(),
    b = benefit(c);
  it("is Available when the allowance is known, coverage is fresh and nothing matched", () => {
    const p = period(c, b);
    expect(rowStatus(p, now)).toBe("available");
    expect(amountText(p, "available")).toBe("$35 left");
  });
  it("is Used when confirmed use reaches the allowance, and shows $X of $Y", () => {
    const p = period(c, b, { confirmed_cents: 3500, remaining_cents: 0 });
    expect(rowStatus(p, now)).toBe("used");
    expect(amountText(p, "used")).toBe("$35 of $35");
  });
  it("is Unknown when coverage is stale, and the amount reads $35? (never 'unconfirmed')", () => {
    const p = period(c, b, { coverage_through: "2026-08-06" });
    expect(rowStatus(p, now)).toBe("unknown");
    expect(amountText(p, "unknown")).toBe("$35?");
    const missing = period(c, b, {
      coverage_status: "unavailable",
      last_reconciled_at: null,
      confirmed_cents: 1000,
      remaining_cents: 2500,
    });
    expect(rowStatus(missing, now)).toBe("unknown");
    expect(amountText(missing, "unknown")).toBe("$25?");
    expect(amountText(missing, "unknown")).not.toMatch(/unconfirmed/i);
  });
  it("is Unknown with no amount when the allowance is not established", () => {
    const p = period(c, b, { allowance_cents: null, remaining_cents: null });
    expect(rowStatus(p, now)).toBe("unknown");
    expect(amountText(p, "unknown")).toBe("Unknown");
  });
  it("is Review only when a candidate is waiting, even with stale coverage", () => {
    const p = period(c, b, {
      candidate_cents: 1000,
      coverage_through: "2026-08-06",
    });
    expect(rowStatus(p, now)).toBe("review");
  });
  it("is Not enrolled when the owner said so, ahead of every other status", () => {
    const nb = benefit(c, {
      enrollment_required: true,
      enrollment_status: "inactive",
    });
    expect(rowStatus(period(c, nb, { candidate_cents: 500 }), now)).toBe(
      "not_enrolled",
    );
    expect(
      rowStatus(
        period(c, benefit(c, { eligibility_status: "ineligible" })),
        now,
      ),
    ).toBe("not_enrolled");
  });
  it("does not turn unknown enrollment into a status", () => {
    const ub = benefit(c, {
      enrollment_required: true,
      enrollment_status: "unknown",
    });
    expect(rowStatus(period(c, ub), now)).toBe("available");
  });
  it("reads units as units", () => {
    const ub = benefit(c, {
      nominal_amount_cents: null,
      nominal_units: 4,
      unit_label: "passes",
    });
    const p = period(c, ub, {
      rule_snapshot: { nominal_units: 4, unit_label: "passes" },
      confirmed_units: 1,
      remaining_units: 3,
      remaining_cents: null,
    });
    expect(amountText(p, rowStatus(p, now))).toBe("3 passes left");
  });
});

describe("groups and ordering (rules 6, 7 and Home)", () => {
  const c = card(),
    other = card({ display_name: "Second synthetic card" });
  const soon = period(c, benefit(c, { name: "Soon" })),
    big = period(c, benefit(c, { name: "Big", nominal_amount_cents: 5000 }), {
      remaining_cents: 5000,
    }),
    done = period(c, benefit(c, { name: "Done" }), {
      confirmed_cents: 3500,
      remaining_cents: 0,
    }),
    skipped = period(
      c,
      benefit(c, {
        name: "Skipped",
        enrollment_required: true,
        enrollment_status: "inactive",
      }),
    ),
    yearly = period(
      other,
      benefit(other, { name: "Yearly", cadence: "calendar_year" }),
      {
        period_start: "2026-01-01",
        period_end_exclusive: "2027-01-01",
        cadence: "calendar_year",
      },
    );
  it("sorts by remaining within the same end, folds Used and Not enrolled rows, and leaves Not enrolled out of totals", () => {
    const [monthly, calendar] = groupRows(
      [soon, done, skipped, big, yearly],
      now,
    );
    expect(monthly.rows.map((p) => p.benefit_name)).toEqual(["Big", "Soon"]);
    expect(monthly.done.map((p) => p.benefit_name)).toEqual(["Done"]);
    expect(monthly.notEnrolled.map((p) => p.benefit_name)).toEqual(["Skipped"]);
    expect(monthly.allowanceCents).toBe(5000 + 3500 + 3500);
    expect(monthly.confirmedCents).toBe(3500);
    expect(monthly.endsOn).toBe("2026-10-31");
    expect(calendar.label).toBe("Calendar year");
  });
  it("groups Home by end date across cards, leaving out Used and Not enrolled rows", () => {
    const groups = expiryGroups([yearly, soon, done, skipped, big], now);
    expect(groups.map((g) => g.day)).toEqual(["2026-10-31", "2026-12-31"]);
    expect(groups[0].rows.map((p) => p.benefit_name)).toEqual(["Big", "Soon"]);
    expect(groups[0].remainingCents).toBe(8500);
    expect(expiryHeading("2026-10-31", "2026-10-28")).toBe("Ending Saturday");
    expect(expiryHeading("2026-12-31", "2026-10-28")).toBe("By Dec 31");
    expect(endsLabel("2026-10-30", "2026-10-28")).toBe("Fri");
    expect(endsLabel("2026-10-29", "2026-10-28")).toBe("tomorrow");
    expect(endsLabel("2027-01-15", "2026-10-28")).toBe("Jan 15, 2027");
  });
});

describe("memberships (rule 11)", () => {
  const c = card();
  const apple = benefit(c, {
    name: "Synthetic streaming membership",
    kind: "membership",
    cadence: "custom",
    nominal_amount_cents: null,
    enrollment_required: true,
    enrollment_status: "unknown",
    activated_on: "2026-10-28",
    activation_assumed: true,
    custom_end_exclusive: "2027-06-23",
    effective_to: "2027-06-23",
  });
  it("is Active through the end of its window, or Not activated", () => {
    expect(membershipStatus(apple, "2026-10-28")).toBe("active");
    expect(membershipThrough(apple)).toBe("2027-06-22");
    expect(
      membershipStatus({ ...apple, activated_on: null }, "2026-10-28"),
    ).toBe("not_activated");
    expect(
      membershipStatus(
        { ...apple, enrollment_status: "inactive" },
        "2026-10-28",
      ),
    ).toBe("not_activated");
    expect(
      membershipThrough({ custom_end_exclusive: null, effective_to: null }),
    ).toBeNull();
  });
  it("never produces an allowance alert, and alerts only as its window closes", () => {
    // A stray period from before the backfill would otherwise ask for its allowance.
    const stray = period(c, apple, {
      allowance_cents: null,
      remaining_cents: null,
      rule_snapshot: { partial_rule_window: true },
    });
    const quiet = deriveAlerts({
      data: snapshot({ cards: [c], benefits: [apple], periods: [stray] }),
      leadDays: 7,
      acknowledged: [],
      now,
      lookup: () => undefined,
    });
    expect(quiet).toEqual([]);
    const closing = {
      ...apple,
      activated_on: null,
      custom_end_exclusive: "2026-11-02",
      effective_to: "2026-11-02",
    };
    const [alert] = attention(
      deriveAlerts({
        data: snapshot({ cards: [c], benefits: [closing] }),
        leadDays: 7,
        acknowledged: [],
        now,
        lookup: () => undefined,
      }),
    );
    expect(alert.title).toBe(
      "Activate Synthetic streaming membership by Nov 1, 2026",
    );
    const ending = deriveAlerts({
      data: snapshot({
        cards: [c],
        benefits: [{ ...closing, activated_on: "2026-10-01" }],
      }),
      leadDays: 7,
      acknowledged: [],
      now,
      lookup: () => undefined,
    });
    expect(ending.map((a) => a.title)).toEqual([
      "Synthetic streaming membership ends Nov 1, 2026",
    ]);
  });
});

describe("Not enrolled rows stop alerting (rule 4)", () => {
  it("drops ending-soon, candidate and terms alerts for a benefit the owner is not enrolled in", () => {
    const c = card();
    const b = benefit(c, {
      enrollment_required: true,
      enrollment_status: "inactive",
      eligibility_rules_json: {
        catalog_rule_id: "x",
        catalog_rule_version: "2026-01-01",
      },
    });
    const p = period(c, b, { candidate_cents: 1000 });
    const alerts = deriveAlerts({
      data: snapshot({
        cards: [c],
        benefits: [b],
        periods: [p],
        evidence: [candidate(p, 1000)],
      }),
      leadDays: 7,
      acknowledged: [],
      now,
      lookup: () => undefined,
    });
    expect(alerts).toEqual([]);
  });
});

describe("reviewQueue (rule 8)", () => {
  it("lists candidates, ending-soon rows with no evidence, stale cards as notes, and enrollment", () => {
    const c = card({ display_name: "Synthetic Reserve" }),
      g = card({ display_name: "Synthetic Gold" });
    const fresh = period(c, benefit(c, { name: "Fresh" })),
      used = benefit(c, { name: "Matched" }),
      matched = period(c, used, { candidate_cents: 1000 }),
      stale = period(g, benefit(g, { name: "Stale" }), {
        coverage_through: "2026-08-06",
      }),
      ask = benefit(c, {
        name: "Ask",
        enrollment_required: true,
        enrollment_status: "unknown",
      }),
      e = candidate(matched, 1000);
    const data = snapshot({
      cards: [c, g],
      benefits: [used, ask],
      periods: [fresh, matched, stale],
      evidence: [e],
    });
    const alerts = deriveAlerts({
      data,
      leadDays: 7,
      acknowledged: [],
      now,
      lookup: () => undefined,
    });
    const q = reviewQueue(data, alerts, now);
    expect(q.candidates.map((x) => x.evidence.id)).toEqual([e.id]);
    expect(q.endingSoon.map((x) => x.period?.benefit_name)).toEqual(["Fresh"]);
    expect(q.stale.map((s) => [s.card.display_name, s.count])).toEqual([
      ["Synthetic Gold", 1],
    ]);
    expect(q.enrollment.map((x) => x.benefits.map((b) => b.name))).toEqual([
      ["Ask"],
    ]);
    expect(q.count).toBe(3);
  });
});
