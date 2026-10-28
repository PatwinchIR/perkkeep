import { beforeAll, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { fixture, freshClient, ok, user } from "./helpers";
let alice: Awaited<ReturnType<typeof user>>,
  bob: Awaited<ReturnType<typeof user>>;
beforeAll(async () => {
  alice = await user();
  bob = await user();
});
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
const event = (periodId: string, extras: Record<string, unknown> = {}) => ({
  benefit_period_id: periodId,
  source_type: "purchase",
  source_reference_hash: hash(randomUUID()),
  transaction_date: "2026-10-10",
  amount_cents: 500,
  confidence: "candidate",
  eligibility_result: "eligible",
  recorded_by: "import",
  ...extras,
});
const balance = async (id: string) =>
  ok(await alice.client.from("period_balances").select().eq("id", id).single());

describe("real local Supabase Auth → Data API → PostgreSQL spike", () => {
  it("authenticates, writes evidence, reads it back, and repeats twice without duplicates", async () => {
    const { period } = await fixture(alice.client);
    const input = event(period.id);
    const first = ok(
      await alice.client.rpc("record_evidence", { p_record: input }),
    );
    for (let attempt = 0; attempt < 2; attempt++)
      expect(
        ok(await alice.client.rpc("record_evidence", { p_record: input })).id,
      ).toBe(first.id);
    expect(
      ok(
        await alice.client
          .from("redemption_evidence")
          .select()
          .eq("benefit_period_id", period.id),
      ),
    ).toHaveLength(1);
    const b = await balance(period.id);
    expect(Number(b.candidate_cents)).toBe(500);
    expect(Number(b.confirmed_cents)).toBe(0);
    expect(Number(b.remaining_cents)).toBe(1000);
  });
  it("hides every owner table and the view from other users and anonymous clients", async () => {
    const { card, period } = await fixture(alice.client);
    ok(
      await alice.client.rpc("record_evidence", { p_record: event(period.id) }),
    );
    for (const table of [
      "cards",
      "benefits",
      "benefit_periods",
      "redemption_evidence",
      "sync_runs",
      "audit_events",
      "period_balances",
    ]) {
      expect(
        ok(
          await bob.client
            .from(table)
            .select("*")
            .eq("owner_user_id", alice.id),
        ),
      ).toHaveLength(0);
      expect((await freshClient().from(table).select()).error).toBeTruthy();
    }
    expect(
      (
        await bob.client.from("benefits").insert({
          card_id: card.id,
          name: "Intrusion",
          cadence: "monthly",
          effective_from: "2026-01-01",
        })
      ).error,
    ).toBeTruthy();
    expect(
      (await bob.client.rpc("record_evidence", { p_record: event(period.id) }))
        .error,
    ).toBeTruthy();
    expect(
      (
        await alice.client
          .from("cards")
          .update({ owner_user_id: bob.id })
          .eq("id", card.id)
      ).error,
    ).toBeTruthy();
  });
  it("preserves October through November, December and January rollovers", async () => {
    const { benefit, period } = await fixture(alice.client);
    const snapshot = period.rule_snapshot;
    for (const day of ["2026-11-01", "2026-12-31", "2027-01-01"])
      ok(
        await alice.client.rpc("ensure_period", {
          p_benefit_id: benefit.id,
          p_on: day,
        }),
      );
    const all = ok(
      await alice.client
        .from("benefit_periods")
        .select()
        .eq("benefit_id", benefit.id)
        .order("period_start"),
    );
    expect(all.map((x) => x.period_start)).toEqual([
      "2026-10-01",
      "2026-11-01",
      "2026-12-01",
      "2027-01-01",
    ]);
    expect(all[0].id).toBe(period.id);
    expect(all[0].rule_snapshot).toEqual(snapshot);
    expect(
      (await alice.client.from("benefit_periods").delete().eq("id", period.id))
        .error,
    ).toBeTruthy();
    expect(
      (
        await alice.client
          .from("benefit_periods")
          .update({ allowance_cents: 99999 })
          .eq("id", period.id)
      ).error,
    ).toBeTruthy();
    expect(
      (
        await alice.client
          .from("benefits")
          .update({ nominal_amount_cents: 2000 })
          .eq("id", benefit.id)
      ).error,
    ).toBeTruthy();
  });
  it.each([
    ["quarterly", "2026-07-01", "2026-07-01", "2026-10-01"],
    ["semiannual", "2026-07-01", "2026-07-01", "2027-01-01"],
    ["calendar_year", "2027-01-01", "2027-01-01", "2028-01-01"],
    ["cardmember_year", "2026-03-14", "2025-03-15", "2026-03-15"],
    ["cardmember_year", "2026-03-15", "2026-03-15", "2027-03-15"],
  ])("computes %s at %s", async (cadence, day, start, end) => {
    const { benefit } = await fixture(alice.client, cadence);
    const p = ok(
      await alice.client.rpc("ensure_period", {
        p_benefit_id: benefit.id,
        p_on: day,
      }),
    );
    expect([p.period_start, p.period_end_exclusive]).toEqual([start, end]);
  });
  it("clamps leap anniversary and suppresses allowance in partial effective windows", async () => {
    expect(
      ok(
        await alice.client.rpc("anniversary", {
          p_anchor: "2024-02-29",
          p_year: 2025,
        }),
      ),
    ).toBe("2025-02-28");
    const { period } = await fixture(alice.client, "monthly", {
      effective_from: "2026-10-10",
    });
    expect(period.period_start).toBe("2026-10-10");
    expect(period.allowance_cents).toBeNull();
    expect(period.rule_snapshot.partial_rule_window).toBe(true);
  });
  it("keeps corrections auditable, links purchase → posted credit, applies partial reversal", async () => {
    const { period } = await fixture(alice.client);
    const candidate = ok(
      await alice.client.rpc("record_evidence", { p_record: event(period.id) }),
    );
    const credit = ok(
      await alice.client.rpc("record_evidence", {
        p_record: event(period.id, {
          source_type: "statement_credit",
          confidence: "confirmed",
          transaction_date: "2026-11-09",
          amount_cents: 300,
          supersedes_evidence_id: candidate.id,
        }),
      }),
    );
    expect(Number((await balance(period.id)).candidate_cents)).toBe(0);
    expect(Number((await balance(period.id)).confirmed_cents)).toBe(300);
    ok(
      await alice.client.rpc("record_evidence", {
        p_record: event(period.id, {
          source_type: "reversal",
          confidence: "confirmed",
          amount_cents: -100,
          transaction_date: "2026-11-12",
          notes: "Synthetic issuer-reversed entitlement",
        }),
      }),
    );
    expect(Number((await balance(period.id)).confirmed_cents)).toBe(200);
    expect(
      ok(
        await alice.client
          .from("redemption_evidence")
          .select()
          .eq("benefit_period_id", period.id),
      ),
    ).toHaveLength(3);
    expect(
      (
        await alice.client
          .from("redemption_evidence")
          .update({ amount_cents: 99 })
          .eq("id", credit.id)
      ).error,
    ).toBeTruthy();
  });
  it("rejects conflicting idempotency payloads, purchase confirmations and inference overrides", async () => {
    const { period } = await fixture(alice.client);
    const input = event(period.id);
    ok(await alice.client.rpc("record_evidence", { p_record: input }));
    expect(
      (
        await alice.client.rpc("record_evidence", {
          p_record: { ...input, amount_cents: 600 },
        })
      ).error,
    ).toBeTruthy();
    expect(
      (
        await alice.client.rpc("record_evidence", {
          p_record: event(period.id, { confidence: "confirmed" }),
        })
      ).error,
    ).toBeTruthy();
    const manual = ok(
      await alice.client.rpc("record_evidence", {
        p_record: event(period.id, {
          recorded_by: "user",
          source_type: "manual",
          confidence: "confirmed",
          notes: "User verified in issuer portal",
        }),
      }),
    );
    expect(
      (
        await alice.client.rpc("record_evidence", {
          p_record: event(period.id, { supersedes_evidence_id: manual.id }),
        })
      ).error,
    ).toBeTruthy();
    expect(
      (
        await alice.client.rpc("record_evidence", {
          p_record: event(period.id, { transaction_date: "2026-11-01" }),
        })
      ).error,
    ).toBeTruthy();
  });
  it("keeps unavailable coverage explicit and logs failed transactional imports without partial writes", async () => {
    const { period } = await fixture(alice.client);
    expect(period.coverage_status).toBe("unavailable");
    const key = randomUUID();
    const valid = event(period.id);
    const result = ok(
      await alice.client.rpc("apply_reconciliation", {
        p_request_key: key,
        p_trigger: "manual",
        p_periods: [],
        p_evidence: [valid, { ...event(period.id), confidence: "confirmed" }],
        p_summary: { source: "synthetic", finances_available: false },
      }),
    );
    expect(result.status).toBe("failed");
    expect(result.error_summary).toBeTruthy();
    expect(
      ok(
        await alice.client
          .from("redemption_evidence")
          .select()
          .eq("benefit_period_id", period.id),
      ),
    ).toHaveLength(0);
    const args = {
      p_request_key: randomUUID(),
      p_trigger: "manual",
      p_periods: [
        {
          id: period.id,
          coverage_status: "partial",
          coverage_through: "2026-10-20",
        },
      ],
      p_evidence: [valid],
      p_summary: { source: "synthetic" },
    };
    const run = ok(await alice.client.rpc("apply_reconciliation", args));
    expect(run.status).toBe("partial");
    expect(ok(await alice.client.rpc("apply_reconciliation", args)).id).toBe(
      run.id,
    );
    expect((await balance(period.id)).coverage_status).toBe("partial");
  });
  it("rejects cross-period correction chains and retains unit-based benefits", async () => {
    const one = await fixture(alice.client),
      two = await fixture(alice.client, "monthly", {
        nominal_amount_cents: null,
        nominal_units: 2,
        unit_label: "visits",
      });
    const old = ok(
      await alice.client.rpc("record_evidence", {
        p_record: event(one.period.id),
      }),
    );
    expect(
      (
        await alice.client.rpc("record_evidence", {
          p_record: event(two.period.id, {
            amount_cents: null,
            units: 1,
            supersedes_evidence_id: old.id,
          }),
        })
      ).error,
    ).toBeTruthy();
    ok(
      await alice.client.rpc("record_evidence", {
        p_record: event(two.period.id, {
          amount_cents: null,
          units: 1,
          source_type: "issuer_portal",
          confidence: "confirmed",
        }),
      }),
    );
    const b = await balance(two.period.id);
    expect(Number(b.confirmed_units)).toBe(1);
    expect(b.remaining_cents).toBeNull();
  });
});

describe("catalog and durable versions", () => {
  it("initializes nine unverified cards idempotently and flags the unknown product", async () => {
    const owner = await user();
    expect((await owner.client.rpc("initialize_cards")).error).toBeNull();
    expect((await owner.client.rpc("initialize_cards")).error).toBeNull();
    const cards = ok(await owner.client.from("cards").select());
    expect(cards).toHaveLength(9);
    const inks = cards.filter((c) => c.product_name?.startsWith("Chase Ink"));
    expect(inks).toHaveLength(2);
    expect(inks.every((c) => c.last4 === null && c.status === "unknown")).toBe(
      true,
    );
    expect(cards.every((c) => c.identity_verified_at === null)).toBe(true);
    expect(cards.every((c) => c.last4 === null)).toBe(true);
    expect(
      cards.find((c) => c.catalog_key === "chase-unidentified").product_name,
    ).toBeNull();
  });
  it("preserves an annual period snapshot after a midyear rule revision", async () => {
    const { benefit, period } = await fixture(alice.client, "calendar_year");
    const next = ok(
      await alice.client.rpc("version_benefit", {
        p_benefit_id: benefit.id,
        p_effective_from: "2026-11-01",
        p_changes: { nominal_amount_cents: 2000 },
      }),
    );
    const current = ok(
      await alice.client.rpc("ensure_period", {
        p_benefit_id: next.id,
        p_on: "2026-11-10",
      }),
    );
    expect(current.allowance_cents).toBeNull();
    expect(current.rule_snapshot.partial_rule_window).toBe(true);
    expect((await balance(period.id)).rule_snapshot).toEqual(
      period.rule_snapshot,
    );
  });
  it("rejects forged period boundaries and unknown anniversary dates", async () => {
    const { period } = await fixture(alice.client);
    const insert = { ...period };
    delete insert.id;
    expect(
      (
        await alice.client.from("benefit_periods").insert({
          ...insert,
          period_start: "2026-12-02",
          period_end_exclusive: "2026-12-31",
        })
      ).error,
    ).toBeTruthy();
    const { benefit, card } = await fixture(alice.client, "cardmember_year");
    ok(
      await alice.client
        .from("cards")
        .update({ cardmember_anchor_date: null })
        .eq("id", card.id)
        .select()
        .single(),
    );
    expect(
      (
        await alice.client.rpc("ensure_period", {
          p_benefit_id: benefit.id,
          p_on: "2027-10-01",
        })
      ).error,
    ).toBeTruthy();
  });
});

describe("reconciliation edge cases", () => {
  it.each(["custom", "one_time"])(
    "uses explicit %s dates without inheriting the card anniversary",
    async (cadence) => {
      const { period } = await fixture(alice.client, cadence, {
        effective_from: "2026-10-01",
        custom_end_exclusive: "2026-12-15",
      });
      expect([
        period.period_start,
        period.period_end_exclusive,
        period.allowance_cents,
      ]).toEqual(["2026-10-01", "2026-12-15", 1000]);
    },
  );
  it("serializes concurrent duplicate evidence and refuses changed reconciliation retries", async () => {
    const { period } = await fixture(alice.client);
    const input = event(period.id);
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        alice.client.rpc("record_evidence", { p_record: input }),
      ),
    );
    const ids = results.map((r) => ok(r).id);
    expect(new Set(ids).size).toBe(1);
    const args = {
      p_request_key: randomUUID(),
      p_trigger: "manual",
      p_periods: [],
      p_evidence: [],
      p_summary: { source: "synthetic" },
    };
    ok(await alice.client.rpc("apply_reconciliation", args));
    expect(
      (
        await alice.client.rpc("apply_reconciliation", {
          ...args,
          p_evidence: [event(period.id)],
        })
      ).error,
    ).toBeTruthy();
  });
  it("retains a failed coverage check and leaves the previous snapshot unchanged", async () => {
    const { period } = await fixture(alice.client);
    const run = ok(
      await alice.client.rpc("apply_reconciliation", {
        p_request_key: randomUUID(),
        p_trigger: "manual",
        p_periods: [
          {
            id: period.id,
            coverage_status: "complete",
            coverage_through: "2099-12-31",
          },
        ],
        p_evidence: [],
        p_summary: { source: "synthetic" },
      }),
    );
    expect(run.status).toBe("failed");
    expect((await balance(period.id)).coverage_status).toBe("unavailable");
  });
});

describe("Ink card additions", () => {
  it("keeps unknown digits honest and preserves edited cards when initialization repeats", async () => {
    const owner = await user();
    expect((await owner.client.rpc("initialize_cards")).error).toBeNull();
    const cards = ok(await owner.client.from("cards").select());
    const cash = cards.find(
      (c) => c.product_name === "Chase Ink Business Cash",
    );
    const preferred = cards.find(
      (c) => c.product_name === "Chase Ink Business Preferred",
    );
    expect(cash.last4).toBeNull();
    expect(preferred.last4).toBeNull();
    expect(
      (
        await owner.client
          .from("cards")
          .update({ last4: "0555", display_name: "Business expenses" })
          .eq("id", cash.id)
      ).error,
    ).toBeNull();
    expect((await owner.client.rpc("initialize_cards")).error).toBeNull();
    const after = ok(await owner.client.from("cards").select());
    expect(after).toHaveLength(9);
    expect(after.find((c) => c.id === cash.id)).toMatchObject({
      last4: "0555",
      display_name: "Business expenses",
      identity_verified_at: null,
    });
    expect(
      (
        await owner.client
          .from("cards")
          .update({ last4: "12" })
          .eq("id", preferred.id)
      ).error,
    ).toBeTruthy();
    expect(
      ok(await bob.client.from("cards").select().eq("id", cash.id)),
    ).toHaveLength(0);
  });
  it("does not duplicate an Ink product already identified on an existing card", async () => {
    const owner = await user();
    const card = ok(
      await owner.client
        .from("cards")
        .insert({
          issuer: "Chase",
          display_name: "Ink Business Cash",
          product_name: "Chase Ink Business Cash",
          last4: "4242",
        })
        .select()
        .single(),
    );
    expect((await owner.client.rpc("initialize_cards")).error).toBeNull();
    const cards = ok(await owner.client.from("cards").select());
    expect(cards).toHaveLength(9);
    expect(
      cards
        .filter((c) => c.product_name === "Chase Ink Business Cash")
        .map((c) => c.id),
    ).toEqual([card.id]);
  });
});
