// Alert and progress engine on SYNTHETIC snapshots. No database.
import { describe, expect, it } from "vitest";
import {
  activity,
  attention,
  catalogLink,
  deriveAlerts,
  digest,
  groupByCadence,
  progress,
  termsDifferences,
} from "../src/lib/alerts";
import type { BenefitRule } from "../src/lib/catalog";
import { DEFAULT_SETTINGS } from "../src/lib/types";
import type {
  Account,
  Benefit,
  Card,
  Evidence,
  Period,
  Snapshot,
} from "../src/lib/types";

const now = new Date("2026-10-28T15:00:00Z");
const iso = (d: Date) => d.toISOString();
const daysAgo = (n: number) => iso(new Date(now.getTime() - n * 86400000));
let seq = 0;
const id = (prefix: string) => `${prefix}-${++seq}`;

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
    nominal_amount_cents: 1000,
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
      unit_label: b.unit_label,
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
function evidence(p: Period, extra: Partial<Evidence> = {}): Evidence {
  return {
    id: id("evidence"),
    owner_user_id: "owner",
    card_id: p.card_id,
    benefit_period_id: p.id,
    source_type: "manual",
    source_reference_hash: null,
    transaction_date: "2026-10-14",
    recorded_at: daysAgo(2),
    merchant: "Synthetic Grill",
    amount_cents: 300,
    units: null,
    eligibility_result: "eligible",
    confirmation_result: "User checked",
    confidence: "confirmed",
    recorded_by: "user",
    notes: "synthetic",
    supersedes_evidence_id: null,
    ...extra,
  };
}
function account(extra: Partial<Account> = {}): Account {
  return {
    id: id("account"),
    source: "simplefin",
    connection_id: "conn",
    institution: "Synthetic Bank",
    name: "Synthetic card ...1234",
    mask: "1234",
    kind: "credit",
    currency: "USD",
    proposed_card_id: null,
    card_id: null,
    mapping_status: "unmapped",
    mapping_confirmed_at: null,
    created_at: daysAgo(5),
    earliest_synced_on: "2026-09-01",
    synced_through: "2026-10-27",
    last_attempted_at: daysAgo(1),
    last_success_at: daysAgo(1),
    last_error: null,
    transaction_rows: 10,
    balance_cents: null,
    balance_observed_at: null,
    ...extra,
  };
}
function snapshot(parts: Partial<Snapshot> = {}): Snapshot {
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
    ...parts,
  };
}
const rule: BenefitRule = {
  id: "synthetic/credit",
  version: "2026-10-28",
  name: "Synthetic allowance",
  period: "monthly",
  amount_cents: 1000,
  enrollment_required: false,
  eligibility_notes: "synthetic",
  source_url: "https://example.com/synthetic",
  checked_on: "2026-10-28",
  effective_from: null,
  effective_to: null,
  verified: true,
  manual: false,
  matching: {
    credit_patterns: [],
    purchase_patterns: [],
    patterns_verified: false,
  },
};
const derive = (
  data: Snapshot,
  extra: Partial<Parameters<typeof deriveAlerts>[0]> = {},
) =>
  deriveAlerts({
    data,
    leadDays: 7,
    acknowledged: data.acknowledgements.map((a) => a.alert_key),
    now,
    lookup: (x) => (x === rule.id ? rule : undefined),
    ...extra,
  });
const kinds = (data: Snapshot) => derive(data).map((a) => a.kind);

describe("progress", () => {
  it("reports confirmed and candidate fractions, time left and trust", () => {
    const c = card(),
      b = benefit(c),
      p = period(c, b, {
        confirmed_cents: 300,
        candidate_cents: 400,
        remaining_cents: 700,
      });
    const pr = progress(p, now);
    expect(pr).toMatchObject({
      unit: "cents",
      allowance: 1000,
      confirmed: 300,
      candidate: 400,
      remaining: 700,
      trusted: true,
      daysTotal: 31,
      daysLeft: 4,
      confirmedFraction: 0.3,
      candidateFraction: 0.4,
      partialWindow: false,
    });
    expect(pr.elapsedFraction).toBeCloseTo(27 / 31, 5);
  });
  it("never shows a bar for an unknown allowance and caps candidates at the remainder", () => {
    const c = card(),
      b = benefit(c);
    const partial = period(c, b, {
      allowance_cents: null,
      remaining_cents: null,
      rule_snapshot: { nominal_amount_cents: 1000, partial_rule_window: true },
    });
    expect(progress(partial, now)).toMatchObject({
      allowance: null,
      confirmedFraction: null,
      candidateFraction: null,
      partialWindow: true,
    });
    const over = period(c, b, {
      confirmed_cents: 800,
      candidate_cents: 900,
      remaining_cents: 200,
    });
    expect(progress(over, now).candidateFraction).toBeCloseTo(0.2, 5);
  });
  it("handles unit-based benefits and expired periods", () => {
    const c = card(),
      b = benefit(c, {
        nominal_amount_cents: null,
        nominal_units: 2,
        unit_label: "visits",
      });
    const p = period(c, b, {
      period_start: "2026-07-01",
      period_end_exclusive: "2026-10-01",
      confirmed_units: 1,
      remaining_units: 1,
    });
    expect(progress(p, now)).toMatchObject({
      unit: "units",
      unitLabel: "visits",
      allowance: 2,
      confirmed: 1,
      remaining: 1,
      daysLeft: 0,
      elapsedFraction: 1,
      confirmedFraction: 0.5,
    });
  });
});

describe("attention alerts", () => {
  it("asks for card setup, account links and missing periods, and keeps them until resolved", () => {
    const c = card({ identity_verified_at: null, product_name: null });
    const data = snapshot({
      cards: [c],
      accounts: [account(), account({ kind: "depository" })],
      periodErrors: [
        "Synthetic allowance: Cardmember anniversary needs confirmation",
      ],
      acknowledgements: [
        { alert_key: `setup:${c.id}`, acknowledged_at: daysAgo(1) },
      ],
    });
    const alerts = derive(data);
    expect(alerts.map((a) => a.kind)).toEqual([
      "setup",
      "account_link",
      "no_period",
    ]);
    expect(alerts[0].dismissible).toBe(false);
    expect(alerts[0].href).toBe(`/cards/${c.id}`);
  });
  it("flags a newer rule file version with the changed terms, a retired rule, and an issuer end date", () => {
    const c = card();
    const linked = benefit(c, {
      nominal_amount_cents: 700,
      eligibility_rules_json: {
        catalog_rule_id: rule.id,
        catalog_rule_version: "2026-09-01",
      },
    });
    const current = benefit(c, {
      eligibility_rules_json: {
        catalog_rule_id: rule.id,
        catalog_rule_version: "2026-10-28",
      },
    });
    const retired = benefit(c, {
      eligibility_rules_json: { catalog_rule_id: "synthetic/gone" },
    });
    const ended = benefit(c, {
      eligibility_rules_json: {
        catalog_rule_id: "synthetic/ended",
        catalog_rule_version: "2026-10-28",
      },
    });
    const endedRule = {
      ...rule,
      id: "synthetic/ended",
      effective_to: "2026-10-01",
    };
    const alerts = derive(
      snapshot({ cards: [c], benefits: [linked, current, retired, ended] }),
      {
        lookup: (x) =>
          x === rule.id ? rule : x === endedRule.id ? endedRule : undefined,
      },
    ).filter((a) => a.kind === "terms_changed");
    expect(alerts.map((a) => a.benefitId)).toEqual([
      ended.id,
      retired.id,
      linked.id,
    ]);
    const change = alerts.find((a) => a.benefitId === linked.id)!;
    expect(change.key).toBe(`terms:${linked.id}:2026-10-28`);
    expect(change.detail).toContain("Allowance $7 → $10");
    expect(change.context).toMatchObject({
      from_version: "2026-09-01",
      to_version: "2026-10-28",
    });
    expect(alerts.find((a) => a.benefitId === ended.id)!.detail).toContain(
      "Sep 30, 2026",
    );
    expect(catalogLink(linked)).toEqual({
      id: rule.id,
      version: "2026-09-01",
    });
  });
  it("asks for a partial-window allowance and for re-verification after 180 days, resolvable only by action", () => {
    const c = card();
    const old = benefit(c, { verified_at: daysAgo(200) });
    const rechecked = benefit(c, {
      verified_at: daysAgo(200),
      last_reverified_at: daysAgo(5),
    });
    const p = period(c, old, {
      allowance_cents: null,
      remaining_cents: null,
      rule_snapshot: { nominal_amount_cents: 1000, partial_rule_window: true },
    });
    const data = snapshot({
      cards: [c],
      benefits: [old, rechecked],
      periods: [p],
      acknowledgements: [
        { alert_key: `allowance:${p.id}`, acknowledged_at: daysAgo(1) },
        {
          alert_key: `reverify:${old.id}:${daysAgo(200).slice(0, 10)}`,
          acknowledged_at: daysAgo(1),
        },
      ],
    });
    expect(kinds(data)).toEqual(["allowance_needed", "reverify"]);
    expect(derive(data)[1].benefitId).toBe(old.id);
  });
  it("lists candidates per evidence row and ignores superseded ones", () => {
    const c = card(),
      b = benefit(c),
      p = period(c, b, { candidate_cents: 500, remaining_cents: 1000 });
    const first = evidence(p, {
      source_type: "purchase",
      confidence: "candidate",
      recorded_by: "import",
      amount_cents: 500,
    });
    const replaced = evidence(p, {
      source_type: "purchase",
      confidence: "candidate",
      recorded_by: "import",
      amount_cents: 200,
    });
    const rejection = evidence(p, {
      confidence: "rejected",
      amount_cents: 200,
      supersedes_evidence_id: replaced.id,
    });
    const alerts = derive(
      snapshot({
        cards: [c],
        benefits: [b],
        periods: [p],
        evidence: [first, replaced, rejection],
      }),
    );
    expect(alerts.filter((a) => a.kind === "candidate")).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      key: `candidate:${first.id}`,
      evidenceId: first.id,
      dismissible: false,
      href: "/review",
    });
    expect(alerts[0].title).toContain("$5");
  });
  it("warns about windows ending within the lead days, honestly about coverage", () => {
    const c = card(),
      b = benefit(c);
    const fresh = period(c, b, { confirmed_cents: 300, remaining_cents: 700 });
    const stale = period(c, b, {
      period_start: "2026-10-01",
      period_end_exclusive: "2026-11-01",
      coverage_status: "unavailable",
      last_reconciled_at: null,
      coverage_through: null,
      remaining_cents: 1000,
    });
    const used = period(c, b, { confirmed_cents: 1000, remaining_cents: 0 });
    const far = period(c, b, {
      period_start: "2026-10-01",
      period_end_exclusive: "2027-01-01",
      cadence: "quarterly",
    });
    const alerts = derive(
      snapshot({
        cards: [c],
        benefits: [b],
        periods: [fresh, stale, used, far],
      }),
    );
    const expiring = alerts.filter((a) => a.kind === "expiring");
    expect(expiring.map((a) => a.periodId).sort()).toEqual(
      [fresh.id, stale.id].sort(),
    );
    expect(expiring.find((a) => a.periodId === fresh.id)!.title).toBe(
      "$7 known available: Synthetic allowance",
    );
    expect(expiring.find((a) => a.periodId === stale.id)!.title).toBe(
      "$10 not yet confirmed used: Synthetic allowance",
    );
    expect(expiring[0].detail).toContain("4 days left");
    expect(alerts.find((a) => a.kind === "coverage_stale")).toMatchObject({
      title: "Coverage not fresh for 1 benefit",
      dismissible: true,
    });
    expect(
      derive(snapshot({ cards: [c], benefits: [b], periods: [fresh] }), {
        leadDays: 3,
      }).filter((a) => a.kind === "expiring"),
    ).toHaveLength(0);
  });
  it("reports stale or failing linked accounts once, with a key that follows the failure", () => {
    const c = card();
    const failing = account({
      card_id: c.id,
      mapping_status: "confirmed",
      mapping_confirmed_at: daysAgo(3),
      last_error: "SimpleFIN returned status 500.",
    });
    const data = snapshot({ cards: [c], accounts: [failing] });
    const [a] = derive(data);
    expect(a.kind).toBe("sync_failing");
    expect(a.title).toBe("1 linked account is stale or failing");
    const later = snapshot({
      cards: [c],
      accounts: [{ ...failing, last_attempted_at: daysAgo(0) }],
      acknowledgements: [{ alert_key: a.key, acknowledged_at: daysAgo(0) }],
    });
    expect(derive(later)).toHaveLength(1);
    expect(derive(later)[0].key).not.toBe(a.key);
  });
});

describe("activity and acknowledgements", () => {
  it("lists recent confirmed use and completed periods, newest first, and hides acknowledged ones", () => {
    const c = card(),
      b = benefit(c),
      p = period(c, b, { confirmed_cents: 1000, remaining_cents: 0 });
    const early = evidence(p, { amount_cents: 400, recorded_at: daysAgo(6) });
    const late = evidence(p, {
      amount_cents: 600,
      recorded_at: daysAgo(1),
      recorded_by: "import",
      source_type: "statement_credit",
      merchant: "SYNTHETIC CREDIT",
    });
    const old = evidence(p, { amount_cents: 100, recorded_at: daysAgo(40) });
    const data = snapshot({
      cards: [c],
      benefits: [b],
      periods: [p],
      evidence: [early, late, old],
    });
    const all = derive(data);
    expect(attention(all)).toHaveLength(0);
    expect(activity(all).map((a) => a.kind)).toEqual([
      "used",
      "completed",
      "used",
    ]);
    expect(activity(all)[0]).toMatchObject({
      key: `used:${late.id}`,
      title: "Used $6: Synthetic allowance",
    });
    expect(activity(all)[0].detail).toContain("matched from your statement");
    expect(activity(all)[1]).toMatchObject({
      key: `completed:${p.id}`,
      title: "Synthetic allowance fully used",
    });
    const hidden = derive(
      snapshot({
        ...data,
        acknowledgements: [
          { alert_key: `used:${late.id}`, acknowledged_at: daysAgo(0) },
          { alert_key: `completed:${p.id}`, acknowledged_at: daysAgo(0) },
        ],
      }),
    );
    expect(hidden.map((a) => a.key)).toEqual([`used:${early.id}`]);
  });
  it("labels reversals and keeps attention before activity", () => {
    const c = card(),
      b = benefit(c),
      p = period(c, b, {
        confirmed_cents: 200,
        candidate_cents: 500,
        remaining_cents: 800,
      });
    const reversal = evidence(p, {
      source_type: "reversal",
      amount_cents: -100,
      recorded_at: daysAgo(1),
    });
    const candidate = evidence(p, {
      source_type: "purchase",
      confidence: "candidate",
      recorded_by: "import",
      amount_cents: 500,
    });
    const alerts = derive(
      snapshot({
        cards: [c],
        benefits: [b],
        periods: [p],
        evidence: [reversal, candidate],
      }),
    );
    expect(alerts.map((a) => a.kind)).toEqual([
      "candidate",
      "expiring",
      "used",
    ]);
    expect(alerts[2].title).toBe("Reversal of $1: Synthetic allowance");
  });
});

describe("grouping and helpers", () => {
  it("groups current periods by reset timeframe in time order with totals", () => {
    const c = card();
    const monthly = benefit(c),
      yearly = benefit(c, {
        cadence: "calendar_year",
        nominal_amount_cents: 30000,
      }),
      visits = benefit(c, {
        cadence: "semiannual",
        nominal_amount_cents: null,
        nominal_units: 2,
        unit_label: "visits",
      });
    const groups = groupByCadence(
      [
        period(c, yearly, {
          cadence: "calendar_year",
          period_start: "2026-01-01",
          period_end_exclusive: "2027-01-01",
          confirmed_cents: 30000,
          remaining_cents: 0,
        }),
        period(c, visits, {
          cadence: "semiannual",
          period_start: "2026-07-01",
          period_end_exclusive: "2027-01-01",
        }),
        period(c, monthly, { confirmed_cents: 250, remaining_cents: 750 }),
      ],
      now,
    );
    expect(groups.map((g) => [g.label, g.periods.length])).toEqual([
      ["Monthly", 1],
      ["Half-yearly", 1],
      ["Calendar year", 1],
    ]);
    expect(groups[0]).toMatchObject({
      allowanceCents: 1000,
      confirmedCents: 250,
      remainingCents: 750,
      endsOn: "2026-11-01",
      unknownAllowance: false,
    });
    expect(groups[1].allowanceCents).toBe(0);
  });
  it("describes term differences and digests deterministically", () => {
    const c = card();
    const b = benefit(c, {
      name: "Old name",
      cadence: "quarterly",
      nominal_amount_cents: 500,
      enrollment_required: true,
      issuer_source_url: "https://example.com/old",
    });
    expect(termsDifferences(b, rule)).toEqual([
      "Name “Old name” → “Synthetic allowance”",
      "Reset Quarterly → Monthly",
      "Allowance $5 → $10",
      "Enrollment no longer required",
      "Issuer source URL changed",
    ]);
    expect(termsDifferences(benefit(c), rule)).toEqual([]);
    expect(digest("a|b")).toBe(digest("a|b"));
    expect(digest("a|b")).not.toBe(digest("b|a"));
    expect(digest("x")).toMatch(/^[0-9a-f]{8}$/);
  });
});
