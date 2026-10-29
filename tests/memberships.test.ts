// Migration 0006 and the membership operations, on SYNTHETIC owners and cards.
import { afterAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { ensurePeriod, env, insert, user } from "./helpers";

process.env.PERKKEEP_DATABASE_URL = env.TEST_APP_URL;
process.env.PERKKEEP_ENCRYPTION_KEY = randomBytes(32).toString("base64");
const { withOwner, closePool } = await import("../src/server/db");
const { runOperation, loadSnapshot } = await import("../src/server/ledger");
afterAll(() => closePool());

type Owner = Awaited<ReturnType<typeof user>>;
async function reserve(owner: Owner) {
  return insert(owner, "cards", {
    issuer: "Synthetic Issuer",
    display_name: "Synthetic Reserve",
    status: "active",
    identity_verified_at: new Date().toISOString(),
    cardmember_anchor_date: "2026-08-28",
  });
}
// A benefit shaped like the ones createBenefit added in production on 2026-10-28 (D55).
const rule = (cardId: string, extra: Record<string, unknown>) => ({
  card_id: cardId,
  description: "Synthetic test rule — not an entitlement",
  issuer_source_url: "https://example.com/synthetic-test-only",
  verified_at: new Date().toISOString(),
  enabled: true,
  eligibility_status: "eligible",
  ...extra,
});

describe("migration 0006: benefit kinds", () => {
  it("defaults to allowance and keeps memberships free of amounts", async () => {
    const owner = await user(),
      card = await reserve(owner);
    const b = await insert(
      owner,
      "benefits",
      rule(card.id, {
        name: "Synthetic allowance",
        cadence: "monthly",
        nominal_amount_cents: 1000,
        effective_from: "2026-01-01",
      }),
    );
    expect(b.kind).toBe("allowance");
    expect(b.activation_assumed).toBe(true);
    await expect(
      insert(
        owner,
        "benefits",
        rule(card.id, {
          name: "Synthetic membership with an amount",
          cadence: "monthly",
          nominal_amount_cents: 1000,
          effective_from: "2026-01-01",
          kind: "membership",
        }),
      ),
    ).rejects.toThrow(/benefits_membership_without_allowance/);
  });
  it("lets kind and activation change after periods exist, but not back, not into the future, and not the terms", async () => {
    const owner = await user(),
      card = await reserve(owner);
    const b = await insert(
      owner,
      "benefits",
      rule(card.id, {
        name: "Synthetic status",
        cadence: "custom",
        effective_from: "2026-10-28",
        effective_to: "2027-06-23",
        custom_end_exclusive: "2027-06-23",
      }),
    );
    await ensurePeriod(owner, b.id, "2026-10-28");
    await owner.q(
      "update public.benefits set kind='membership', activated_on='2026-10-28' where id=$1",
      [b.id],
    );
    await expect(
      owner.q("update public.benefits set kind='allowance' where id=$1", [
        b.id,
      ]),
    ).rejects.toThrow(/cannot become an allowance/);
    await expect(
      owner.q(
        "update public.benefits set activated_on=current_date+30 where id=$1",
        [b.id],
      ),
    ).rejects.toThrow(/Activation cannot be in the future/);
    await expect(
      owner.q("update public.benefits set name='Renamed' where id=$1", [b.id]),
    ).rejects.toThrow(/new benefit version/);
  });
});

describe("classifyMemberships backfill", () => {
  it("turns benefits without an amount into memberships, keeping activation dates and the assumed flag", async () => {
    const owner = await user(),
      card = await reserve(owner),
      other = await reserve(owner);
    const apple = await insert(
      owner,
      "benefits",
      rule(card.id, {
        name: "Synthetic streaming membership",
        cadence: "custom",
        enrollment_required: true,
        enrollment_status: "unknown",
        effective_from: "2026-10-28",
        effective_to: "2027-06-23",
        custom_end_exclusive: "2027-06-23",
        eligibility_rules_json: {
          effective_date_confirmed_by: "assumed_needs_owner_confirmation",
        },
      }),
    );
    const tier = await insert(
      owner,
      "benefits",
      rule(card.id, {
        name: "Synthetic hotel status (spend tier)",
        cadence: "custom",
        enrollment_required: true,
        enrollment_status: "unknown",
        effective_from: "2026-10-23",
        effective_to: "2027-12-31",
        custom_end_exclusive: "2027-12-31",
        eligibility_rules_json: {
          effective_date_confirmed_by: "owner_transactions",
        },
      }),
    );
    const lounge = await insert(
      owner,
      "benefits",
      rule(card.id, {
        name: "Synthetic lounge membership",
        cadence: "cardmember_year",
        effective_from: "2026-01-01",
        eligibility_rules_json: {
          effective_date_confirmed_by: "default_start_of_year",
        },
      }),
    );
    const credit = await insert(
      owner,
      "benefits",
      rule(card.id, {
        name: "Synthetic shopping credit",
        cadence: "custom",
        nominal_amount_cents: 25000,
        effective_from: "2026-10-23",
        effective_to: "2027-01-01",
        custom_end_exclusive: "2027-01-01",
      }),
    );
    const elsewhere = await insert(
      owner,
      "benefits",
      rule(other.id, {
        name: "Synthetic membership on another card",
        cadence: "custom",
        effective_from: "2026-10-28",
        effective_to: "2027-01-01",
        custom_end_exclusive: "2027-01-01",
      }),
    );
    for (const b of [apple, tier, lounge, credit])
      await ensurePeriod(owner, b.id, "2026-10-28");
    const before = await owner.q(
      "select count(*)::int as n from public.benefit_periods",
    );
    const result = (await withOwner(owner.id, (tx) =>
      runOperation(tx, "classifyMemberships", { card_id: card.id }),
    )) as {
      classified: {
        id: string;
        activated_on: string;
        activation_assumed: boolean;
      }[];
    };
    const byId = new Map(result.classified.map((r) => [r.id, r]));
    expect([...byId.keys()].sort()).toEqual(
      [apple.id, tier.id, lounge.id].sort(),
    );
    expect(byId.get(apple.id)).toMatchObject({
      activated_on: "2026-10-28",
      activation_assumed: true,
    });
    expect(byId.get(tier.id)).toMatchObject({
      activated_on: "2026-10-23",
      activation_assumed: false,
    });
    expect(byId.get(lounge.id)).toMatchObject({
      activated_on: "2026-01-01",
      activation_assumed: true,
    });
    const [rest] = await owner.q(
      "select (select kind from public.benefits where id=$1) as credit, (select kind from public.benefits where id=$2) as elsewhere",
      [credit.id, elsewhere.id],
    );
    expect(rest).toEqual({ credit: "allowance", elsewhere: "allowance" });
    // Nothing is deleted: periods stay, the snapshot just stops showing them.
    expect(
      await owner.q("select count(*)::int as n from public.benefit_periods"),
    ).toEqual(before);
    const audit = await owner.q(
      "select count(*)::int as n from public.audit_events where entity_id=$1 and action='UPDATE'",
      [apple.id],
    );
    expect(audit[0].n).toBe(1);
    const snapshot = await withOwner(owner.id, (tx) => loadSnapshot(tx));
    expect(
      snapshot.periods
        .filter((p) => p.card_id === card.id)
        .map((p) => p.benefit_id),
    ).toEqual([credit.id]);
    const again = (await withOwner(owner.id, (tx) =>
      runOperation(tx, "classifyMemberships", { card_id: card.id }),
    )) as { classified: unknown[] };
    expect(again.classified).toEqual([]);
  });

  it("sets an activation date, answers enrollment, and saves the checklist", async () => {
    const owner = await user(),
      card = await reserve(owner);
    const m = await insert(
      owner,
      "benefits",
      rule(card.id, {
        name: "Synthetic membership",
        cadence: "custom",
        kind: "membership",
        enrollment_required: true,
        enrollment_status: "unknown",
        activated_on: "2026-10-28",
        effective_from: "2026-10-01",
        custom_end_exclusive: "2027-06-23",
      }),
    );
    const a = await insert(
      owner,
      "benefits",
      rule(card.id, {
        name: "Synthetic enrollable credit",
        cadence: "monthly",
        nominal_amount_cents: 1000,
        enrollment_required: true,
        enrollment_status: "unknown",
        effective_from: "2026-01-01",
      }),
    );
    await ensurePeriod(owner, a.id, "2026-10-28");
    const saved = (await withOwner(owner.id, (tx) =>
      runOperation(tx, "setActivation", {
        id: m.id,
        activated_on: "2026-10-05",
      }),
    )) as {
      activated_on: string;
      activation_assumed: boolean;
      enrollment_status: string;
    };
    expect(saved).toMatchObject({
      activated_on: "2026-10-05",
      activation_assumed: false,
      enrollment_status: "active",
    });
    await expect(
      withOwner(owner.id, (tx) =>
        runOperation(tx, "setActivation", {
          id: a.id,
          activated_on: "2026-10-05",
        }),
      ),
    ).rejects.toThrow(/Record not found/);
    await withOwner(owner.id, (tx) =>
      runOperation(tx, "saveEnrollment", {
        card_id: card.id,
        answers: [{ id: a.id, enrolled: false }],
      }),
    );
    const [row] = await owner.q(
      "select enrollment_status from public.benefits where id=$1",
      [a.id],
    );
    expect(row.enrollment_status).toBe("inactive");
  });
});
