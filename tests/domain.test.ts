import { describe, it, expect } from "vitest";
import {
  coverageFresh,
  knownAvailable,
  localDate,
  parseCents,
  status,
} from "../src/lib/domain";
import type { Period } from "../src/lib/types";
const now = new Date("2026-10-27T15:00:00Z");
const period = {
  period_start: "2026-10-01",
  period_end_exclusive: "2026-11-01",
  issuer_timezone: "America/New_York",
  identity_verified_at: "2026-01-01",
  card_status: "active",
  enabled: true,
  eligibility_status: "eligible",
  enrollment_required: false,
  coverage_status: "complete",
  coverage_through: "2026-10-27",
  last_reconciled_at: now.toISOString(),
  allowance_cents: 1000,
  remaining_cents: 700,
  confirmed_cents: 300,
  candidate_cents: 400,
  confirmed_units: 0,
  candidate_units: 0,
  allowance_units: null,
  unresolved_count: 0,
  negative_balance: false,
} as Period;
describe("honest benefit summaries", () => {
  it("separates candidates from confirmed remaining credit", () => {
    expect(knownAvailable(period, now)).toBe(700);
    expect(status(period, now)).toBe("candidate");
  });
  it.each(["unavailable", "partial"])(
    "suppresses available totals for %s coverage",
    (coverage) => {
      const p = {
        ...period,
        coverage_status: coverage,
        confirmed_cents: 0,
        candidate_cents: 0,
      };
      expect(knownAvailable(p, now)).toBeNull();
      expect(status(p, now)).toBe("needs_review");
    },
  );
  it("suppresses unknown enrollment, allowance, ineligible and closed cards", () => {
    expect(
      knownAvailable(
        { ...period, enrollment_required: true, enrollment_status: "unknown" },
        now,
      ),
    ).toBeNull();
    expect(
      knownAvailable(
        { ...period, allowance_cents: null, remaining_cents: null },
        now,
      ),
    ).toBeNull();
    expect(
      knownAvailable({ ...period, eligibility_status: "ineligible" }, now),
    ).toBeNull();
    expect(
      knownAvailable({ ...period, card_status: "closed" }, now),
    ).toBeNull();
  });
  it("does not treat a stale or future observation as complete", () => {
    expect(
      coverageFresh(
        { ...period, last_reconciled_at: "2026-10-01T12:00:00Z" },
        now,
      ),
    ).toBe(false);
    expect(
      coverageFresh(
        { ...period, last_reconciled_at: "2026-12-01T12:00:00Z" },
        now,
      ),
    ).toBe(false);
  });
  it("turns over at issuer-local midnight including DST", () => {
    expect(localDate(new Date("2026-11-01T03:59:59Z"))).toBe("2026-10-31");
    expect(localDate(new Date("2026-11-01T04:00:00Z"))).toBe("2026-11-01");
    expect(localDate(new Date("2027-01-01T04:59:59Z"))).toBe("2026-12-31");
    expect(status(period, new Date("2026-11-01T04:00:00Z"))).toBe("expired");
  });
  it("parses exact integer cents and rejects rounding or malformed input", () => {
    expect(parseCents("10.10")).toBe(1010);
    expect(parseCents("0.01")).toBe(1);
    for (const x of ["1.999", "-1", "NaN", "2e3", "10000000000"])
      expect(() => parseCents(x)).toThrow();
  });
});
