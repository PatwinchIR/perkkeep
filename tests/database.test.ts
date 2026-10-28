import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import {
  anonymous,
  appPool,
  applyReconciliation,
  ensurePeriod,
  fixture,
  insert,
  recordEvidence,
  user,
} from "./helpers";
let alice: Awaited<ReturnType<typeof user>>,
  bob: Awaited<ReturnType<typeof user>>;
beforeAll(async () => {
  alice = await user();
  bob = await user();
});
afterAll(() => appPool.end());
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
const balance = (id: string) =>
  alice.one("select * from public.period_balances where id=$1", [id]);

describe("PostgreSQL ledger under the restricted role (Neon model)", () => {
  it("writes evidence, reads it back, and repeats twice without duplicates", async () => {
    const { period } = await fixture(alice);
    const input = event(period.id);
    const first = await recordEvidence(alice, input);
    for (let attempt = 0; attempt < 2; attempt++)
      expect((await recordEvidence(alice, input)).id).toBe(first.id);
    expect(
      await alice.q(
        "select * from public.redemption_evidence where benefit_period_id=$1",
        [period.id],
      ),
    ).toHaveLength(1);
    const b = await balance(period.id);
    expect(Number(b.candidate_cents)).toBe(500);
    expect(Number(b.confirmed_cents)).toBe(0);
    expect(Number(b.remaining_cents)).toBe(1000);
  });
  it("hides every owner table and the view from other owners and from connections without an identity", async () => {
    const { card, period } = await fixture(alice);
    await recordEvidence(alice, event(period.id));
    for (const table of [
      "owners",
      "cards",
      "benefits",
      "benefit_periods",
      "redemption_evidence",
      "sync_runs",
      "audit_events",
      "period_balances",
    ]) {
      const column = table === "owners" ? "id" : "owner_user_id";
      expect(
        await bob.q(`select * from public.${table} where ${column}=$1`, [
          alice.id,
        ]),
      ).toHaveLength(0);
      expect(await anonymous().q(`select * from public.${table}`)).toHaveLength(
        0,
      );
    }
    await expect(
      insert(bob, "benefits", {
        card_id: card.id,
        name: "Intrusion",
        cadence: "monthly",
        effective_from: "2026-01-01",
      }),
    ).rejects.toThrow();
    await expect(
      insert(anonymous(), "cards", { issuer: "x", display_name: "Intrusion" }),
    ).rejects.toThrow();
    await expect(recordEvidence(bob, event(period.id))).rejects.toThrow();
    await expect(
      alice.q("update public.cards set owner_user_id=$1 where id=$2", [
        bob.id,
        card.id,
      ]),
    ).rejects.toThrow();
    // The restricted role cannot create owners directly or read other identities.
    await expect(
      insert(bob, "owners", {
        auth_provider: "test",
        auth_subject: "forged",
        email: "forged@perkkeep.test",
      }),
    ).rejects.toThrow();
  });
  it("runs as a role that cannot bypass row-level security and owns no tables", async () => {
    const [role] = await anonymous().q(
      `select r.rolsuper, r.rolbypassrls,
        (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','app','private') and c.relowner=r.oid)::int as owned
       from pg_roles r where r.rolname=current_user`,
    );
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false, owned: 0 });
    await expect(
      anonymous().q("select private.audit_change()"),
    ).rejects.toThrow();
  });
  it("keeps identity transaction-local so a pooled connection does not carry it into the next request", async () => {
    const client = await appPool.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.owner_id',$1,true)", [
        alice.id,
      ]);
      await client.query("commit");
      const { rows } = await client.query(
        "select app.current_owner() as id, count(*)::int as n from public.cards",
      );
      expect(rows[0]).toEqual({ id: null, n: 0 });
    } finally {
      client.release();
    }
  });
  it("preserves October through November, December and January rollovers", async () => {
    const { benefit, period } = await fixture(alice);
    const snapshot = period.rule_snapshot;
    for (const day of ["2026-11-01", "2026-12-31", "2027-01-01"])
      await ensurePeriod(alice, benefit.id, day);
    const all = await alice.q(
      "select * from public.benefit_periods where benefit_id=$1 order by period_start",
      [benefit.id],
    );
    expect(all.map((x) => x.period_start)).toEqual([
      "2026-10-01",
      "2026-11-01",
      "2026-12-01",
      "2027-01-01",
    ]);
    expect(all[0].id).toBe(period.id);
    expect(all[0].rule_snapshot).toEqual(snapshot);
    await expect(
      alice.q("delete from public.benefit_periods where id=$1", [period.id]),
    ).rejects.toThrow();
    await expect(
      alice.q(
        "update public.benefit_periods set allowance_cents=99999 where id=$1",
        [period.id],
      ),
    ).rejects.toThrow();
    await expect(
      alice.q(
        "update public.benefits set nominal_amount_cents=2000 where id=$1",
        [benefit.id],
      ),
    ).rejects.toThrow();
  });
  it.each([
    ["quarterly", "2026-07-01", "2026-07-01", "2026-10-01"],
    ["semiannual", "2026-07-01", "2026-07-01", "2027-01-01"],
    ["calendar_year", "2027-01-01", "2027-01-01", "2028-01-01"],
    ["cardmember_year", "2026-03-14", "2025-03-15", "2026-03-15"],
    ["cardmember_year", "2026-03-15", "2026-03-15", "2027-03-15"],
  ])("computes %s at %s", async (cadence, day, start, end) => {
    const { benefit } = await fixture(alice, cadence);
    const p = await ensurePeriod(alice, benefit.id, day);
    expect([p.period_start, p.period_end_exclusive]).toEqual([start, end]);
  });
  it("clamps leap anniversary and suppresses allowance in partial effective windows", async () => {
    expect(
      (await alice.one("select public.anniversary('2024-02-29',2025) as d")).d,
    ).toBe("2025-02-28");
    const { period } = await fixture(alice, "monthly", {
      effective_from: "2026-10-10",
    });
    expect(period.period_start).toBe("2026-10-10");
    expect(period.allowance_cents).toBeNull();
    expect(period.rule_snapshot.partial_rule_window).toBe(true);
  });
  it("keeps corrections auditable, links purchase → posted credit, applies partial reversal", async () => {
    const { period } = await fixture(alice);
    const candidate = await recordEvidence(alice, event(period.id));
    const credit = await recordEvidence(
      alice,
      event(period.id, {
        source_type: "statement_credit",
        confidence: "confirmed",
        transaction_date: "2026-11-09",
        amount_cents: 300,
        supersedes_evidence_id: candidate.id,
      }),
    );
    expect(Number((await balance(period.id)).candidate_cents)).toBe(0);
    expect(Number((await balance(period.id)).confirmed_cents)).toBe(300);
    await recordEvidence(
      alice,
      event(period.id, {
        source_type: "reversal",
        confidence: "confirmed",
        amount_cents: -100,
        transaction_date: "2026-11-12",
        notes: "Synthetic issuer-reversed entitlement",
      }),
    );
    expect(Number((await balance(period.id)).confirmed_cents)).toBe(200);
    expect(
      await alice.q(
        "select * from public.redemption_evidence where benefit_period_id=$1",
        [period.id],
      ),
    ).toHaveLength(3);
    await expect(
      alice.q(
        "update public.redemption_evidence set amount_cents=99 where id=$1",
        [credit.id],
      ),
    ).rejects.toThrow();
    const audit = await alice.q(
      "select * from public.audit_events where entity_id=$1",
      [credit.id],
    );
    expect(audit.map((a) => a.action)).toEqual(["INSERT"]);
  });
  it("rejects conflicting idempotency payloads, purchase confirmations and inference overrides", async () => {
    const { period } = await fixture(alice);
    const input = event(period.id);
    await recordEvidence(alice, input);
    await expect(
      recordEvidence(alice, { ...input, amount_cents: 600 }),
    ).rejects.toThrow(/Idempotency key reused/);
    await expect(
      recordEvidence(alice, event(period.id, { confidence: "confirmed" })),
    ).rejects.toThrow();
    const manual = await recordEvidence(
      alice,
      event(period.id, {
        recorded_by: "user",
        source_type: "manual",
        confidence: "confirmed",
        notes: "User verified in issuer portal",
      }),
    );
    await expect(
      recordEvidence(
        alice,
        event(period.id, { supersedes_evidence_id: manual.id }),
      ),
    ).rejects.toThrow(/Imports cannot override user evidence/);
    await expect(
      recordEvidence(
        alice,
        event(period.id, { transaction_date: "2026-11-01" }),
      ),
    ).rejects.toThrow(/outside this benefit period/);
  });
  it("keeps unavailable coverage explicit and logs failed transactional imports without partial writes", async () => {
    const { period } = await fixture(alice);
    expect(period.coverage_status).toBe("unavailable");
    const valid = event(period.id);
    const result = await applyReconciliation(alice, {
      p_request_key: randomUUID(),
      p_trigger: "manual",
      p_periods: [],
      p_evidence: [valid, { ...event(period.id), confidence: "confirmed" }],
      p_summary: { source: "synthetic", finances_available: false },
    });
    expect(result.status).toBe("failed");
    expect(result.error_summary).toBeTruthy();
    expect(
      await alice.q(
        "select * from public.redemption_evidence where benefit_period_id=$1",
        [period.id],
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
    const run = await applyReconciliation(alice, args);
    expect(run.status).toBe("partial");
    expect((await applyReconciliation(alice, args)).id).toBe(run.id);
    expect((await balance(period.id)).coverage_status).toBe("partial");
  });
  it("rejects cross-period correction chains and retains unit-based benefits", async () => {
    const one = await fixture(alice),
      two = await fixture(alice, "monthly", {
        nominal_amount_cents: null,
        nominal_units: 2,
        unit_label: "visits",
      });
    const old = await recordEvidence(alice, event(one.period.id));
    await expect(
      recordEvidence(
        alice,
        event(two.period.id, {
          amount_cents: null,
          units: 1,
          supersedes_evidence_id: old.id,
        }),
      ),
    ).rejects.toThrow();
    await recordEvidence(
      alice,
      event(two.period.id, {
        amount_cents: null,
        units: 1,
        source_type: "issuer_portal",
        confidence: "confirmed",
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
    await owner.q("select public.initialize_cards()");
    await owner.q("select public.initialize_cards()");
    const cards = await owner.q("select * from public.cards");
    expect(cards).toHaveLength(9);
    const inks = cards.filter((c) => c.product_name?.startsWith("Chase Ink"));
    expect(inks).toHaveLength(2);
    expect(inks.every((c) => c.last4 === null && c.status === "unknown")).toBe(
      true,
    );
    expect(cards.every((c) => c.identity_verified_at === null)).toBe(true);
    expect(cards.every((c) => c.last4 === null)).toBe(true);
    expect(
      cards.find((c) => c.catalog_key === "chase-unidentified")?.product_name,
    ).toBeNull();
  });
  it("preserves an annual period snapshot after a midyear rule revision", async () => {
    const { benefit, period } = await fixture(alice, "calendar_year");
    const next = await alice.one(
      "select * from public.version_benefit($1,$2,$3)",
      [
        benefit.id,
        JSON.stringify({ nominal_amount_cents: 2000 }),
        "2026-11-01",
      ],
    );
    const current = await ensurePeriod(alice, next.id, "2026-11-10");
    expect(current.allowance_cents).toBeNull();
    expect(current.rule_snapshot.partial_rule_window).toBe(true);
    expect((await balance(period.id)).rule_snapshot).toEqual(
      period.rule_snapshot,
    );
  });
  it("rejects forged period boundaries and unknown anniversary dates", async () => {
    const { period } = await fixture(alice);
    const forged: Record<string, unknown> = {
      ...period,
      period_start: "2026-12-02",
      period_end_exclusive: "2026-12-31",
    };
    for (const k of ["id", "created_at", "updated_at"]) delete forged[k];
    await expect(insert(alice, "benefit_periods", forged)).rejects.toThrow();
    const { benefit, card } = await fixture(alice, "cardmember_year");
    await alice.one(
      "update public.cards set cardmember_anchor_date=null where id=$1 returning *",
      [card.id],
    );
    await expect(ensurePeriod(alice, benefit.id, "2027-10-01")).rejects.toThrow(
      /anniversary/,
    );
  });
});

describe("reconciliation edge cases", () => {
  it.each(["custom", "one_time"])(
    "uses explicit %s dates without inheriting the card anniversary",
    async (cadence) => {
      const { period } = await fixture(alice, cadence, {
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
    const { period } = await fixture(alice);
    const input = event(period.id);
    const results = await Promise.all(
      Array.from({ length: 6 }, () => recordEvidence(alice, input)),
    );
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    const args = {
      p_request_key: randomUUID(),
      p_trigger: "manual",
      p_periods: [],
      p_evidence: [],
      p_summary: { source: "synthetic" },
    };
    await applyReconciliation(alice, args);
    await expect(
      applyReconciliation(alice, { ...args, p_evidence: [event(period.id)] }),
    ).rejects.toThrow(/changed inputs/);
  });
  it("retains a failed coverage check and leaves the previous snapshot unchanged", async () => {
    const { period } = await fixture(alice);
    const run = await applyReconciliation(alice, {
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
    });
    expect(run.status).toBe("failed");
    expect((await balance(period.id)).coverage_status).toBe("unavailable");
  });
});

describe("Ink card additions", () => {
  it("keeps unknown digits honest and preserves edited cards when initialization repeats", async () => {
    const owner = await user();
    await owner.q("select public.initialize_cards()");
    const cards = await owner.q("select * from public.cards");
    const cash = cards.find(
      (c) => c.product_name === "Chase Ink Business Cash",
    )!;
    const preferred = cards.find(
      (c) => c.product_name === "Chase Ink Business Preferred",
    )!;
    expect(cash.last4).toBeNull();
    expect(preferred.last4).toBeNull();
    await owner.q(
      "update public.cards set last4='0555', display_name='Business expenses' where id=$1",
      [cash.id],
    );
    await owner.q("select public.initialize_cards()");
    const after = await owner.q("select * from public.cards");
    expect(after).toHaveLength(9);
    expect(after.find((c) => c.id === cash.id)).toMatchObject({
      last4: "0555",
      display_name: "Business expenses",
      identity_verified_at: null,
    });
    await expect(
      owner.q("update public.cards set last4='12' where id=$1", [preferred.id]),
    ).rejects.toThrow();
    expect(
      await bob.q("select * from public.cards where id=$1", [cash.id]),
    ).toHaveLength(0);
  });
  it("does not duplicate an Ink product already identified on an existing card", async () => {
    const owner = await user();
    const card = await insert(owner, "cards", {
      issuer: "Chase",
      display_name: "Ink Business Cash",
      product_name: "Chase Ink Business Cash",
      last4: "4242",
    });
    await owner.q("select public.initialize_cards()");
    const cards = await owner.q("select * from public.cards");
    expect(cards).toHaveLength(9);
    expect(
      cards
        .filter((c) => c.product_name === "Chase Ink Business Cash")
        .map((c) => c.id),
    ).toEqual([card.id]);
  });
});
