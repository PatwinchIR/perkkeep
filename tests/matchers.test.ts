// Deterministic matcher tests. Owners, cards, accounts and transactions are SYNTHETIC.
import { afterAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { env, insert, user } from "./helpers";
import type { BenefitRule } from "../src/lib/catalog";

process.env.PERKKEEP_DATABASE_URL = env.TEST_APP_URL;
process.env.PERKKEEP_ENCRYPTION_KEY = randomBytes(32).toString("base64");
const { withOwner, closePool } = await import("../src/server/db");
const { runMatchers, periodCoverage } = await import("../src/server/matchers");
const { runSourceOperation } = await import("../src/server/sources/operations");
const { ruleById } = await import("../src/lib/catalog");
afterAll(() => closePool());

const NOW = new Date("2026-10-28T16:00:00Z");
const dunkin = ruleById("amex-gold/dunkin-credit")!;
const verified: BenefitRule = {
  ...dunkin,
  matching: { ...dunkin.matching, patterns_verified: true },
};

async function setup(ruleId = "amex-gold/dunkin-credit") {
  const owner = await user();
  const card = await insert(owner, "cards", {
    issuer: "American Express",
    display_name: "Synthetic Gold",
    product_name: "American Express Gold",
    status: "active",
    identity_verified_at: new Date().toISOString(),
  });
  const benefit = await insert(owner, "benefits", {
    card_id: card.id,
    name: "Synthetic Dunkin' credit",
    cadence: "monthly",
    nominal_amount_cents: 700,
    effective_from: "2026-01-01",
    issuer_source_url: "https://example.com/synthetic-test-only",
    verified_at: new Date().toISOString(),
    enabled: true,
    eligibility_status: "eligible",
    enrollment_status: "active",
    eligibility_rules_json: { catalog_rule_id: ruleId },
  });
  // A synthetic statement covering the whole of October.
  const csv = [
    "Date,Description,Amount",
    "10/01/2026,SYNTHETIC OPENING ROW,-1.00",
    "10/05/2026,DUNKIN #1234 SYNTHETIC,-5.25",
    "10/07/2026,DUNKIN CREDIT SYNTHETIC,5.25",
    "10/12/2026,SYNTHETIC GROCER,-20.00",
    "10/28/2026,SYNTHETIC CLOSING ROW,-1.00",
  ].join("\n");
  const imported = (await runSourceOperation(owner.id, "importCsv", {
    file_name: "synthetic.csv",
    file_text: csv,
    format: "generic-signed",
    new_account: {
      institution: "American Express",
      name: "Synthetic Gold export",
      mask: null,
    },
  })) as { import: { account_id: string } };
  return { owner, card, benefit, accountId: imported.import.account_id };
}
const link = (owner: { id: string }, accountId: string, cardId: string) =>
  withOwner(owner.id, (tx) =>
    tx.query(
      "update public.accounts set card_id=$2, mapping_status='confirmed', mapping_confirmed_at=now() where id=$1",
      [accountId, cardId],
    ),
  );
const balance = (owner: Awaited<ReturnType<typeof user>>, benefitId: string) =>
  owner.one(
    "select * from public.period_balances where benefit_id=$1 and period_start='2026-10-01'",
    [benefitId],
  );

describe("deterministic matcher (synthetic data)", () => {
  it("ignores accounts the owner has not linked to a card", async () => {
    const { owner } = await setup();
    const result = await withOwner(owner.id, (tx) =>
      runMatchers(tx, "manual", ruleById, NOW),
    );
    expect(result.status).toBe("nothing_linked");
    expect(
      await owner.q("select * from public.redemption_evidence"),
    ).toHaveLength(0);
  });

  it("records a purchase and its credit once, never counting both, and keeps coverage partial while patterns are unverified", async () => {
    const { owner, card, benefit, accountId } = await setup();
    await link(owner, accountId, card.id);
    const first = await withOwner(owner.id, (tx) =>
      runMatchers(tx, "manual", ruleById, NOW),
    );
    expect(first).toMatchObject({ candidates: 2, confirmed: 0 });
    const rows = await owner.q(
      "select * from public.redemption_evidence order by recorded_at, source_type",
    );
    expect(
      rows
        .map((r) => [
          r.source_type,
          r.confidence,
          r.recorded_by,
          Number(r.amount_cents),
        ])
        .sort(),
    ).toEqual([
      ["purchase", "candidate", "import", 525],
      ["statement_credit", "candidate", "import", 525],
    ]);
    const credit = rows.find((r) => r.source_type === "statement_credit")!;
    expect(credit.supersedes_evidence_id).toBe(
      rows.find((r) => r.source_type === "purchase")!.id,
    );
    expect(credit.notes).toContain("amex-gold/dunkin-credit");
    const b = await balance(owner, benefit.id);
    expect([
      Number(b.candidate_cents),
      Number(b.confirmed_cents),
      b.coverage_status,
    ]).toEqual([525, 0, "partial"]);
    // A second run adds nothing.
    const again = await withOwner(owner.id, (tx) =>
      runMatchers(tx, "manual", ruleById, NOW),
    );
    expect(again.candidates).toBe(0);
    expect(
      await owner.q("select * from public.redemption_evidence"),
    ).toHaveLength(2);
  });

  it("confirms an issuer credit and reports complete coverage once the credit pattern is verified", async () => {
    const { owner, card, benefit, accountId } = await setup();
    await link(owner, accountId, card.id);
    const result = await withOwner(owner.id, (tx) =>
      runMatchers(
        tx,
        "manual",
        (id) => (id === verified.id ? verified : ruleById(id)),
        NOW,
      ),
    );
    expect(result).toMatchObject({ candidates: 1, confirmed: 1 });
    const b = await balance(owner, benefit.id);
    expect([
      Number(b.confirmed_cents),
      Number(b.remaining_cents),
      b.coverage_status,
      b.coverage_through,
    ]).toEqual([525, 175, "complete", "2026-10-28"]);
  });

  it("never gives coverage to benefits a statement cannot show, such as Uber Cash", async () => {
    const { owner, card, benefit, accountId } = await setup(
      "amex-gold/uber-cash",
    );
    await link(owner, accountId, card.id);
    await withOwner(owner.id, (tx) => runMatchers(tx, "manual", ruleById, NOW));
    expect(
      await owner.q(
        "select * from public.benefit_periods where benefit_id=$1 and coverage_status<>'unavailable'",
        [benefit.id],
      ),
    ).toHaveLength(0);
  });
});

describe("period coverage", () => {
  const p = { period_start: "2026-10-01", period_end_exclusive: "2026-11-01" };
  it("is complete only when a healthy account covers the whole period to date", () => {
    const a = {
      card_id: "c",
      earliest_synced_on: "2026-09-01",
      synced_through: "2026-10-28",
      last_error: null,
    };
    expect(periodCoverage(p, [a], "2026-10-28")).toEqual({
      coverage_status: "complete",
      coverage_through: "2026-10-28",
    });
    expect(
      periodCoverage(
        p,
        [{ ...a, earliest_synced_on: "2026-10-10" }],
        "2026-10-28",
      ).coverage_status,
    ).toBe("partial");
    expect(
      periodCoverage(p, [{ ...a, synced_through: "2026-10-20" }], "2026-10-28"),
    ).toEqual({
      coverage_status: "partial",
      coverage_through: "2026-10-20",
    });
    expect(
      periodCoverage(
        p,
        [{ ...a, last_error: "SimpleFIN returned status 500." }],
        "2026-10-28",
      ).coverage_status,
    ).toBe("unavailable");
  });
});

describe("researched benefits for a confirmed card (synthetic owner)", () => {
  it("adds each researched rule once, skips custom allowance windows, adds memberships and leaves enrollment unknown", async () => {
    const { runOperation } = await import("../src/server/ledger");
    const owner = await user();
    const unconfirmed = await insert(owner, "cards", {
      issuer: "Chase",
      display_name: "Synthetic Reserve",
      catalog_key: "chase-sapphire-reserve",
    });
    await expect(
      withOwner(owner.id, (tx) =>
        runOperation(tx, "addResearchedBenefits", { card_id: unconfirmed.id }),
      ),
    ).rejects.toThrow(/Confirm the active card/);
    await owner.q(
      "update public.cards set status='active', identity_verified_at=now() where id=$1",
      [unconfirmed.id],
    );
    const first = (await withOwner(owner.id, (tx) =>
      runOperation(tx, "addResearchedBenefits", { card_id: unconfirmed.id }),
    )) as { added: string[]; skipped: string[] };
    // Expectations derive from the rule file so adding a rule does not break the test.
    const { RULE_FILES } = await import("../src/lib/catalog");
    const reserve = RULE_FILES.find(
      (f) => f.catalog_key === "chase-sapphire-reserve",
    )!;
    const membership = (r: (typeof reserve.rules)[number]) =>
      r.amount_cents == null && r.units == null;
    expect(first.skipped).toEqual(
      reserve.rules
        .filter((r) => r.period === "custom" && !membership(r))
        .map((r) => r.name),
    );
    expect(first.added).toHaveLength(
      reserve.rules.filter((r) => r.period !== "custom" || membership(r))
        .length,
    );
    expect(first.skipped).toContain("The Shops at Chase credit");
    expect(first.added).toContain(
      "Complimentary Apple TV and Apple Music subscriptions",
    );
    const again = (await withOwner(owner.id, (tx) =>
      runOperation(tx, "addResearchedBenefits", { card_id: unconfirmed.id }),
    )) as { added: string[] };
    expect(again.added).toEqual([]);
    const rows = await owner.q(
      `select name, cadence, kind, activated_on, activation_assumed, custom_end_exclusive, nominal_amount_cents,
         nominal_units, enrollment_required, enrollment_status, eligibility_status,
         eligibility_rules_json->>'catalog_rule_id' as rule from public.benefits`,
    );
    expect(rows).toHaveLength(first.added.length);
    expect(rows.every((r) => r.eligibility_status === "eligible")).toBe(true);
    expect(
      rows.every((r) =>
        r.enrollment_required
          ? r.enrollment_status === "unknown"
          : r.enrollment_status === "not_required",
      ),
    ).toBe(true);
    // Rules without an amount are memberships with an assumed activation date; only they may
    // have custom windows, and they open no periods.
    const memberships = rows.filter((r) => r.kind === "membership");
    expect(memberships.map((r) => r.name).sort()).toEqual(
      reserve.rules
        .filter(membership)
        .map((r) => r.name)
        .sort(),
    );
    expect(
      memberships.every(
        (r) =>
          r.activated_on &&
          r.activation_assumed &&
          r.nominal_amount_cents === null &&
          r.nominal_units === null,
      ),
    ).toBe(true);
    expect(
      memberships.find((r) => r.rule === "csr/apple-tv-apple-music")
        ?.custom_end_exclusive,
    ).toBe("2027-06-23");
    expect(
      rows.some((r) => r.cadence === "custom" && r.kind !== "membership"),
    ).toBe(false);
    const snapshot = await withOwner(owner.id, async (tx) => {
      const { loadSnapshot } = await import("../src/server/ledger");
      return loadSnapshot(tx);
    });
    // Only the travel credit waits for an anniversary; no membership asks for period dates.
    expect(snapshot.periodErrors).toEqual([
      "Annual travel credit: Cardmember anniversary needs confirmation",
    ]);
    const ids = new Set(
      snapshot.benefits.filter((b) => b.kind === "membership").map((b) => b.id),
    );
    expect(snapshot.periods.some((p) => ids.has(p.benefit_id))).toBe(false);
  });
});
