// Hosted (Neon) ledger path against a real local PostgreSQL database.
// Fixtures are synthetic and belong to random test owners. The suite refuses any
// non-local database. Run with PERKKEEP_TEST_DATABASE_URL pointing at a disposable
// local database whose owner role is a non-superuser with BYPASSRLS, like Neon's.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import { migrate } from "../scripts/neon-migrate.mjs";
import { withOwner, type Owner } from "@/lib/server/db";
import { loadSnapshot, runOperation } from "@/lib/server/ledger";
import type { Period, Snapshot } from "@/lib/types";

const url = process.env.PERKKEEP_TEST_DATABASE_URL;
const local =
  !!url && ["127.0.0.1", "localhost"].includes(new URL(url).hostname);
const suite = local ? describe : describe.skip;
let pool: pg.Pool;

const hash = (v: string) => createHash("sha256").update(v).digest("hex");
const newOwner = (): Owner => ({
  neonAuthUserId: `synthetic-${randomUUID()}`,
  email: `synthetic-${randomUUID()}@perkkeep.test`,
});
const run = (owner: Owner, op: string, input: unknown) =>
  withOwner(owner, (c) => runOperation(c, op, input), pool);
const snapshot = (owner: Owner) =>
  withOwner(owner, (c) => loadSnapshot(c), pool) as Promise<Snapshot>;
const balance = async (owner: Owner, id: string) =>
  (await snapshot(owner)).periods.find((p) => p.id === id) as Period;

async function fixture(
  owner: Owner,
  extra: Record<string, unknown> = {},
  on = "2026-10-15",
) {
  await run(owner, "initialize_cards", {});
  const cards = (await snapshot(owner)).cards.filter(
    (c) => c.status === "unknown",
  );
  const card = cards[0];
  await run(owner, "update_card", {
    id: card.id,
    display_name: "Synthetic test card",
    product_name: null,
    last4: null,
    status: "active",
    cardmember_anchor_date: "2020-03-15",
    issuer_timezone: "America/New_York",
  });
  const benefit = (await run(owner, "create_benefit", {
    card_id: card.id,
    name: "Synthetic test allowance — not an entitlement",
    description: "",
    category: "Other",
    cadence: "monthly",
    nominal_amount_cents: 1000,
    nominal_units: null,
    unit_label: null,
    reset_anchor: null,
    custom_end_exclusive: null,
    effective_from: "2020-01-01",
    effective_to: null,
    enrollment_required: false,
    enrollment_status: "not_required",
    eligibility_status: "eligible",
    manual_verification_required: false,
    eligibility_rules_json: {},
    issuer_source_url: "https://example.com/synthetic-test-only",
    verified_at: new Date().toISOString(),
    enabled: true,
    ...extra,
  })) as { id: string };
  const period = (await run(owner, "ensure_period", {
    benefit_id: benefit.id,
    on,
  })) as Period;
  return { card, benefit, period };
}
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

suite("Neon server ledger → restricted role → PostgreSQL RLS", () => {
  let alice: Owner, bob: Owner;
  beforeAll(async () => {
    await migrate(url!, () => undefined);
    pool = new pg.Pool({ connectionString: url, max: 6 });
  });
  beforeEach(() => {
    alice = newOwner();
    bob = newOwner();
  });
  afterAll(async () => {
    await pool?.end();
  });

  it("re-running migrations is a no-op and the owner role really bypasses RLS", async () => {
    const lines: string[] = [];
    await migrate(url!, (l: string) => lines.push(l));
    expect(lines).toEqual(["Schema is up to date."]);
    const owner = await pool.query(
      "select rolbypassrls from pg_roles where rolname = current_user",
    );
    // The test connection mirrors Neon: without the role switch, RLS would not apply.
    expect(owner.rows[0].rolbypassrls).toBe(true);
  });

  it("runs every request as the non-bypassing authenticated role with server-set identity", async () => {
    const seen = await withOwner(
      alice,
      async (c) =>
        (
          await c.query(
            "select current_user, auth.uid() is not null as has_uid, (select rolbypassrls from pg_roles where rolname=current_user) as bypass",
          )
        ).rows[0],
      pool,
    );
    expect(seen).toEqual({
      current_user: "authenticated",
      has_uid: true,
      bypass: false,
    });
    // Identity is transaction-local: a pooled connection keeps no owner afterwards.
    const after = await pool.query(
      "select current_user, current_setting('perkkeep.user_id', true) as uid",
    );
    expect(after.rows[0].current_user).not.toBe("authenticated");
    expect(after.rows[0].uid ?? "").toBe("");
  });

  it("denies the restricted role without an owner, and the anon role entirely", async () => {
    await fixture(alice);
    const c = await pool.connect();
    try {
      await c.query("begin; set local role authenticated");
      expect(
        (await c.query("select count(*)::int as n from public.cards")).rows[0]
          .n,
      ).toBe(0);
      expect(
        (await c.query("select count(*)::int as n from public.period_balances"))
          .rows[0].n,
      ).toBe(0);
      await expect(
        c.query(
          "insert into public.cards(issuer, display_name) values ('x','y')",
        ),
      ).rejects.toThrow();
      await c.query("rollback; begin");
      // The server connection cannot even assume anon, and anon holds no privileges.
      await expect(c.query("set local role anon")).rejects.toThrow(
        /permission denied/,
      );
      await c.query("rollback; begin");
      const anon = await c.query(`select
        has_table_privilege('anon','public.cards','select') as cards,
        has_table_privilege('anon','public.period_balances','select') as balances,
        has_function_privilege('anon','public.record_evidence(jsonb)','execute') as rpc`);
      expect(anon.rows[0]).toEqual({
        cards: false,
        balances: false,
        rpc: false,
      });
      await c.query("set local role authenticated");
      await expect(c.query("select * from auth.users")).rejects.toThrow(
        /permission denied/,
      );
    } finally {
      await c.query("rollback");
      c.release();
    }
  });

  it("writes evidence, reads it back and replays twice without duplicates", async () => {
    const { period } = await fixture(alice);
    const input = event(period.id);
    const first = (await run(alice, "record_evidence", { record: input })) as {
      id: string;
    };
    for (let i = 0; i < 2; i++)
      expect(
        (
          (await run(alice, "record_evidence", { record: input })) as {
            id: string;
          }
        ).id,
      ).toBe(first.id);
    const snap = await snapshot(alice);
    expect(
      snap.evidence.filter((e) => e.benefit_period_id === period.id),
    ).toHaveLength(1);
    const b = snap.periods.find((p) => p.id === period.id)!;
    expect([b.candidate_cents, b.confirmed_cents, b.remaining_cents]).toEqual([
      500, 0, 1000,
    ]);
    expect(typeof b.period_start).toBe("string");
    expect(b.period_start).toBe("2026-10-01");
    expect(
      snap.audit.some((a) => a.entity_id === first.id && a.action === "INSERT"),
    ).toBe(true);
  });

  it("rejects a reused idempotency key carrying changed content", async () => {
    const { period } = await fixture(alice);
    const input = event(period.id);
    await run(alice, "record_evidence", { record: input });
    await expect(
      run(alice, "record_evidence", {
        record: { ...input, amount_cents: 700 },
      }),
    ).rejects.toThrow(/Idempotency key reused/);
  });

  it("converges concurrent duplicate imports on one row", async () => {
    const { period } = await fixture(alice);
    const input = event(period.id);
    const results = (await Promise.all(
      Array.from({ length: 5 }, () =>
        run(alice, "record_evidence", { record: input }),
      ),
    )) as { id: string }[];
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
  });

  it("isolates owners for reads, writes, parents and identity", async () => {
    const { card, benefit, period } = await fixture(alice);
    await run(alice, "record_evidence", { record: event(period.id) });
    const theirs = await snapshot(bob);
    for (const list of [
      theirs.cards,
      theirs.benefits,
      theirs.periods,
      theirs.evidence,
      theirs.runs,
      theirs.audit,
    ])
      expect(JSON.stringify(list)).not.toContain(period.id);
    expect(theirs.cards.map((c) => c.id)).not.toContain(card.id);
    await expect(
      run(bob, "record_evidence", { record: event(period.id) }),
    ).rejects.toThrow();
    await expect(
      run(bob, "update_card", {
        id: card.id,
        display_name: "Intrusion",
        product_name: null,
        last4: null,
        status: "closed",
        cardmember_anchor_date: null,
        issuer_timezone: "America/New_York",
      }),
    ).rejects.toThrow(/unavailable/);
    await expect(
      run(bob, "update_period_notes", { period_id: period.id, notes: "x" }),
    ).rejects.toThrow(/unavailable/);
    await expect(
      run(bob, "set_benefit_enabled", {
        benefit_id: benefit.id,
        enabled: false,
      }),
    ).rejects.toThrow(/unavailable/);
    await expect(
      run(bob, "ensure_period", { benefit_id: benefit.id, on: "2026-11-02" }),
    ).rejects.toThrow();
    await expect(
      run(bob, "create_benefit", { card_id: card.id } as unknown as Record<
        string,
        unknown
      >),
    ).rejects.toThrow(/Invalid create benefit/);
    // Browser-supplied identity fields are rejected before reaching SQL.
    await expect(
      run(alice, "record_evidence", {
        record: { ...event(period.id), owner_user_id: randomUUID() },
      }),
    ).rejects.toThrow(/Invalid record evidence/);
    expect(
      (await snapshot(alice)).cards.find((c) => c.id === card.id)?.status,
    ).toBe("active");
  });

  it("rejects unknown operations and malformed input", async () => {
    await expect(run(alice, "drop_everything", {})).rejects.toThrow(
      /Unknown ledger operation/,
    );
    await expect(run(alice, "__proto__", {})).rejects.toThrow(
      /Unknown ledger operation/,
    );
    await expect(
      run(alice, "ensure_period", { benefit_id: "not-a-uuid" }),
    ).rejects.toThrow(/Invalid/);
  });

  it("preserves historical periods, snapshots and evidence across resets", async () => {
    const { benefit, period } = await fixture(alice);
    await run(alice, "record_evidence", { record: event(period.id) });
    for (const on of ["2026-11-01", "2026-12-31", "2027-01-01"])
      await run(alice, "ensure_period", { benefit_id: benefit.id, on });
    const periods = (await snapshot(alice)).periods
      .filter((p) => p.benefit_id === benefit.id)
      .sort((a, b) => a.period_start.localeCompare(b.period_start));
    expect(periods.map((p) => p.period_start)).toEqual([
      "2026-10-01",
      "2026-11-01",
      "2026-12-01",
      "2027-01-01",
    ]);
    expect(periods[0].id).toBe(period.id);
    expect(periods[0].rule_snapshot).toEqual(period.rule_snapshot);
    expect(periods[0].candidate_cents).toBe(500);
    expect(periods[1].candidate_cents).toBe(0);
  });

  it("counts a confirmed credit that supersedes its candidate exactly once", async () => {
    const { period } = await fixture(alice);
    const candidate = (await run(alice, "record_evidence", {
      record: event(period.id),
    })) as { id: string };
    await run(alice, "record_evidence", {
      record: event(period.id, {
        source_type: "statement_credit",
        confidence: "confirmed",
        transaction_date: "2026-11-09",
        amount_cents: 300,
        supersedes_evidence_id: candidate.id,
      }),
    });
    const b = await balance(alice, period.id);
    expect([b.candidate_cents, b.confirmed_cents, b.remaining_cents]).toEqual([
      0, 300, 700,
    ]);
    // Both records remain readable; nothing was rewritten.
    expect(
      (await snapshot(alice)).evidence.filter(
        (e) => e.benefit_period_id === period.id,
      ),
    ).toHaveLength(2);
    await expect(
      run(alice, "record_evidence", {
        record: event(period.id, {
          source_type: "purchase",
          confidence: "confirmed",
        }),
      }),
    ).rejects.toThrow();
  });

  it("applies reconciliation atomically and idempotently, rejecting changed inputs", async () => {
    const { period } = await fixture(alice);
    const request = {
      request_key: randomUUID(),
      trigger: "manual",
      periods: [
        {
          id: period.id,
          coverage_status: "partial",
          coverage_through: "2026-10-20",
        },
      ],
      evidence: [event(period.id)],
      summary: {
        source: "synthetic_engineering_fixture",
        finances_available: "not_tested",
      },
    };
    const first = (await run(alice, "apply_reconciliation", request)) as {
      id: string;
      status: string;
      candidates_found: number;
    };
    expect([first.status, first.candidates_found]).toEqual(["partial", 1]);
    const again = (await run(alice, "apply_reconciliation", request)) as {
      id: string;
    };
    expect(again.id).toBe(first.id);
    await expect(
      run(alice, "apply_reconciliation", {
        ...request,
        summary: { source: "changed" },
      }),
    ).rejects.toThrow(/changed inputs/);
    const snap = await snapshot(alice);
    expect(
      snap.evidence.filter((e) => e.benefit_period_id === period.id),
    ).toHaveLength(1);
    expect(snap.runs.filter((r) => r.id === first.id)).toHaveLength(1);
    const p = snap.periods.find((x) => x.id === period.id)!;
    expect([p.coverage_status, p.coverage_through]).toEqual([
      "partial",
      "2026-10-20",
    ]);
  });

  it("keeps a failed run but rolls back its evidence and coverage", async () => {
    const { period } = await fixture(alice);
    const failed = (await run(alice, "apply_reconciliation", {
      request_key: randomUUID(),
      trigger: "manual",
      periods: [
        {
          id: period.id,
          coverage_status: "complete",
          coverage_through: "2099-01-01",
        },
      ],
      evidence: [event(period.id)],
      summary: { source: "synthetic_engineering_fixture" },
    })) as { status: string; error_summary: string };
    expect(failed.status).toBe("failed");
    expect(failed.error_summary).toMatch(/future/);
    const snap = await snapshot(alice);
    expect(
      snap.evidence.filter((e) => e.benefit_period_id === period.id),
    ).toHaveLength(0);
    expect(snap.periods.find((x) => x.id === period.id)?.coverage_status).toBe(
      "unavailable",
    );
  });

  it("rolls back every statement of a request that fails midway", async () => {
    const { period } = await fixture(alice);
    await expect(
      withOwner(
        alice,
        async (c) => {
          await runOperation(c, "update_period_notes", {
            period_id: period.id,
            notes: "should vanish",
          });
          throw new Error("synthetic failure after a write");
        },
        pool,
      ),
    ).rejects.toThrow(/synthetic failure/);
    expect((await balance(alice, period.id)).notes).toBe("");
  });

  it("versions rules without rewriting preserved periods", async () => {
    const { benefit, period } = await fixture(alice);
    const terms = (await snapshot(alice)).benefits.find(
      (b) => b.id === benefit.id,
    )!;
    const changes = Object.fromEntries(
      Object.entries(terms).filter(
        ([k]) =>
          ![
            "id",
            "owner_user_id",
            "card_id",
            "rule_key",
            "created_at",
            "updated_at",
          ].includes(k),
      ),
    );
    await run(alice, "version_benefit", {
      benefit_id: benefit.id,
      effective_from: "2026-11-01",
      changes: {
        ...changes,
        effective_from: "2026-11-01",
        nominal_amount_cents: 1500,
      },
    });
    const snap = await snapshot(alice);
    expect(snap.periods.find((p) => p.id === period.id)?.allowance_cents).toBe(
      1000,
    );
    expect(
      snap.benefits.filter((b) => b.rule_key === terms.rule_key),
    ).toHaveLength(2);
  });

  it.each([
    ["quarterly", "2026-07-01", "2026-07-01", "2026-10-01"],
    ["semiannual", "2026-07-01", "2026-07-01", "2027-01-01"],
    ["calendar_year", "2027-01-01", "2027-01-01", "2028-01-01"],
    ["cardmember_year", "2026-03-14", "2025-03-15", "2026-03-15"],
    ["cardmember_year", "2026-03-15", "2026-03-15", "2027-03-15"],
  ])("computes %s periods on %s", async (cadence, on, start, end) => {
    const { period } = await fixture(alice, { cadence }, on);
    expect([period.period_start, period.period_end_exclusive]).toEqual([
      start,
      end,
    ]);
  });

  it.each(["custom", "one_time"])(
    "uses explicit %s dates without inheriting the card anniversary",
    async (cadence) => {
      const { period } = await fixture(alice, {
        cadence,
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

  it("clamps leap anniversaries and leaves a partial effective window without an allowance", async () => {
    const leap = await withOwner(
      alice,
      async (c) =>
        (
          await c.query(
            "select public.anniversary('2024-02-29', 2025)::text as d",
          )
        ).rows[0].d,
      pool,
    );
    expect(leap).toBe("2025-02-28");
    const { period } = await fixture(alice, { effective_from: "2026-10-10" });
    expect(period.period_start).toBe("2026-10-10");
    expect(period.allowance_cents).toBeNull();
    expect(
      (period.rule_snapshot as Record<string, unknown>).partial_rule_window,
    ).toBe(true);
  });

  it("refuses purchase confirmations, import overrides of user evidence and out-of-period purchases", async () => {
    const { period } = await fixture(alice);
    await expect(
      run(alice, "record_evidence", {
        record: event(period.id, { confidence: "confirmed" }),
      }),
    ).rejects.toThrow();
    await expect(
      run(alice, "record_evidence", {
        record: event(period.id, {
          recorded_by: "inference",
          source_type: "statement_credit",
          confidence: "confirmed",
        }),
      }),
    ).rejects.toThrow();
    const manual = (await run(alice, "record_evidence", {
      record: event(period.id, {
        recorded_by: "user",
        source_type: "manual",
        confidence: "confirmed",
        notes: "Synthetic: user verified in issuer portal",
      }),
    })) as { id: string };
    await expect(
      run(alice, "record_evidence", {
        record: event(period.id, { supersedes_evidence_id: manual.id }),
      }),
    ).rejects.toThrow(/Imports cannot override user evidence/);
    await expect(
      run(alice, "record_evidence", {
        record: event(period.id, { transaction_date: "2026-11-01" }),
      }),
    ).rejects.toThrow(/outside this benefit period/);
  });

  it("does not let a refund restore a benefit without a verified, explained reversal", async () => {
    const { period } = await fixture(alice);
    await run(alice, "record_evidence", {
      record: event(period.id, {
        source_type: "statement_credit",
        confidence: "confirmed",
        amount_cents: 300,
      }),
    });
    await run(alice, "record_evidence", {
      record: event(period.id, {
        source_type: "refund",
        confidence: "unknown",
        amount_cents: -300,
      }),
    });
    let b = await balance(alice, period.id);
    expect([b.confirmed_cents, b.remaining_cents, b.unresolved_count]).toEqual([
      300, 700, 1,
    ]);
    await expect(
      run(alice, "record_evidence", {
        record: event(period.id, {
          source_type: "reversal",
          confidence: "confirmed",
          amount_cents: -100,
          recorded_by: "user",
        }),
      }),
    ).rejects.toThrow(/Explain/);
    await run(alice, "record_evidence", {
      record: event(period.id, {
        source_type: "reversal",
        confidence: "confirmed",
        amount_cents: -100,
        recorded_by: "user",
        notes: "Synthetic issuer-reversed entitlement",
      }),
    });
    b = await balance(alice, period.id);
    expect([b.confirmed_cents, b.remaining_cents]).toEqual([200, 800]);
  });

  it("rejects cross-period correction chains and keeps unit-based benefits separate", async () => {
    const one = await fixture(alice);
    const two = await fixture(alice, {
      nominal_amount_cents: null,
      nominal_units: 2,
      unit_label: "visits",
    });
    const old = (await run(alice, "record_evidence", {
      record: event(one.period.id),
    })) as { id: string };
    await expect(
      run(alice, "record_evidence", {
        record: event(two.period.id, {
          amount_cents: null,
          units: 1,
          supersedes_evidence_id: old.id,
        }),
      }),
    ).rejects.toThrow();
    await expect(
      run(alice, "record_evidence", { record: event(two.period.id) }),
    ).rejects.toThrow(/Use units/);
    await run(alice, "record_evidence", {
      record: event(two.period.id, {
        amount_cents: null,
        units: 1,
        source_type: "issuer_portal",
        confidence: "confirmed",
      }),
    });
    const b = await balance(alice, two.period.id);
    expect([b.confirmed_units, b.remaining_units, b.remaining_cents]).toEqual([
      1,
      1,
      null,
    ]);
  });

  it("rejects forged period boundaries and periods without a confirmed anniversary", async () => {
    const { benefit } = await fixture(alice);
    await expect(
      withOwner(
        alice,
        (c) =>
          c.query(
            `insert into public.benefit_periods(card_id, benefit_id, period_start, period_end_exclusive, rule_snapshot)
             select card_id, id, '2026-12-02', '2026-12-31', '{}'::jsonb from public.benefits where id = $1`,
            [benefit.id],
          ),
        pool,
      ),
    ).rejects.toThrow(/reset rules/);
    const anniversary = await fixture(bob, { cadence: "cardmember_year" });
    await run(bob, "update_card", {
      id: anniversary.card.id,
      display_name: "Synthetic test card",
      product_name: null,
      last4: null,
      status: "active",
      cardmember_anchor_date: null,
      issuer_timezone: "America/New_York",
    });
    await expect(
      run(bob, "ensure_period", {
        benefit_id: anniversary.benefit.id,
        on: "2027-10-01",
      }),
    ).rejects.toThrow(/anniversary/);
  });

  it("initializes nine unverified cards idempotently without inventing digits", async () => {
    await run(alice, "initialize_cards", {});
    let cards = (await snapshot(alice)).cards;
    const cash = cards.find(
      (c) => c.product_name === "Chase Ink Business Cash",
    )!;
    await run(alice, "update_card", {
      id: cash.id,
      display_name: "Business expenses",
      product_name: "Chase Ink Business Cash",
      last4: "0555",
      status: "unknown",
      cardmember_anchor_date: null,
      issuer_timezone: "America/New_York",
    });
    await run(alice, "initialize_cards", {});
    cards = (await snapshot(alice)).cards;
    expect(cards).toHaveLength(9);
    expect(
      cards.filter((c) => c.product_name?.startsWith("Chase Ink")),
    ).toHaveLength(2);
    expect(
      cards.find((c) => c.catalog_key === "chase-unidentified")?.product_name,
    ).toBeNull();
    expect(
      cards
        .filter((c) => c.id !== cash.id)
        .every((c) => c.last4 === null && c.identity_verified_at === null),
    ).toBe(true);
    expect(cards.find((c) => c.id === cash.id)).toMatchObject({
      last4: "0555",
      display_name: "Business expenses",
    });
    await expect(
      run(alice, "update_card", {
        id: cash.id,
        display_name: "x",
        product_name: null,
        last4: "12",
        status: "unknown",
        cardmember_anchor_date: null,
        issuer_timezone: "America/New_York",
      }),
    ).rejects.toThrow(/Invalid/);
    await expect(
      run(alice, "update_card", {
        id: cash.id,
        display_name: "x",
        product_name: null,
        last4: null,
        status: "unknown",
        cardmember_anchor_date: null,
        issuer_timezone: "Mars/Olympus_Mons",
      }),
    ).rejects.toThrow(/timezone/);
  });

  it("removes a card by archiving it: history stays, new periods stop, restore is owner-only", async () => {
    const { card, benefit, period } = await fixture(alice);
    await run(alice, "record_evidence", { record: event(period.id) });
    await expect(run(bob, "archive_card", { id: card.id })).rejects.toThrow(
      /unavailable/,
    );
    await run(alice, "archive_card", { id: card.id });
    await expect(run(alice, "archive_card", { id: card.id })).rejects.toThrow(
      /unavailable/,
    );
    let snap = await snapshot(alice);
    expect(snap.cards.find((c) => c.id === card.id)?.archived_at).toBeTruthy();
    const kept = snap.periods.find((p) => p.id === period.id)!;
    expect([kept.candidate_cents, !!kept.card_archived_at]).toEqual([
      500,
      true,
    ]);
    expect(
      snap.evidence.filter((e) => e.benefit_period_id === period.id),
    ).toHaveLength(1);
    expect(snap.periodErrors).toEqual([]);
    await expect(
      run(alice, "ensure_period", { benefit_id: benefit.id, on: "2026-11-02" }),
    ).rejects.toThrow(/removed/);
    await expect(run(bob, "restore_card", { id: card.id })).rejects.toThrow(
      /unavailable/,
    );
    await run(alice, "restore_card", { id: card.id });
    await run(alice, "ensure_period", {
      benefit_id: benefit.id,
      on: "2026-11-02",
    });
    snap = await snapshot(alice);
    expect(snap.cards.find((c) => c.id === card.id)?.archived_at).toBeNull();
    expect(
      snap.audit.filter((a) => a.entity_id === card.id && a.action === "UPDATE")
        .length,
    ).toBeGreaterThanOrEqual(3);
  });

  it("stores a validated card design choice", async () => {
    await run(alice, "initialize_cards", {});
    const discover = (await snapshot(alice)).cards.find(
      (c) => c.catalog_key === "discover-it",
    )!;
    const base = {
      id: discover.id,
      display_name: discover.display_name,
      product_name: discover.product_name,
      last4: null,
      status: "unknown",
      cardmember_anchor_date: null,
      issuer_timezone: "America/New_York",
    };
    await run(alice, "update_card", { ...base, art_design: "gold" });
    expect(
      (await snapshot(alice)).cards.find((c) => c.id === discover.id)
        ?.art_design,
    ).toBe("gold");
    await expect(
      run(alice, "update_card", { ...base, art_design: "<script>" }),
    ).rejects.toThrow(/Invalid/);
  });
});
