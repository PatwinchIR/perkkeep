import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "../src/server/pg-types";

// Synthetic test owners only, in the dedicated local perkkeep_test database.
export const env = JSON.parse(
  readFileSync(".local/postgres.json", "utf8"),
) as Record<string, string>;
for (const key of ["TEST_APP_URL", "TEST_OWNER_URL"])
  if (!["localhost", "127.0.0.1"].includes(new URL(env[key]).hostname))
    throw new Error("Tests refuse non-local databases");
export const appPool = new pg.Pool({
  connectionString: env.TEST_APP_URL,
  max: 8,
});

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export type Session = {
  id: string | null;
  email: string;
  q: (sql: string, params?: unknown[]) => Promise<Row[]>;
  one: (sql: string, params?: unknown[]) => Promise<Row>;
};

// Runs as perkkeep_app with a transaction-local identity, exactly like the server does.
export function session(ownerId: string | null, email = "anonymous"): Session {
  const q = async (sql: string, params: unknown[] = []) => {
    const client = await appPool.connect();
    try {
      await client.query("begin");
      if (ownerId)
        await client.query("select set_config('app.owner_id',$1,true)", [
          ownerId,
        ]);
      const { rows } = await client.query(sql, params);
      await client.query("commit");
      return rows;
    } catch (e) {
      await client.query("rollback");
      throw e;
    } finally {
      client.release();
    }
  };
  return {
    id: ownerId,
    email,
    q,
    one: async (sql, params) => {
      const rows = await q(sql, params);
      if (rows.length !== 1)
        throw new Error(`Expected one row, got ${rows.length}`);
      return rows[0];
    },
  };
}
export const anonymous = () => session(null);

export async function user(
  email = `test-${randomUUID()}@perkkeep.test`,
): Promise<Session & { id: string; subject: string }> {
  const subject = `test-${randomUUID()}`;
  const { rows } = await appPool.query(
    "select app.resolve_owner('test',$1,$2) as id",
    [subject, email],
  );
  return { ...session(rows[0].id, email), id: rows[0].id, subject };
}

// Inserts a row from a plain object. Column names come only from test code.
export function insert(owner: Session, table: string, row: Row) {
  const keys = Object.keys(row);
  return owner.one(
    `insert into public.${table}(${keys.join(",")}) values(${keys.map((_, i) => `$${i + 1}`).join(",")}) returning *`,
    keys.map((k) =>
      row[k] !== null && typeof row[k] === "object"
        ? JSON.stringify(row[k])
        : row[k],
    ),
  );
}
export const recordEvidence = (owner: Session, record: Row) =>
  owner.one("select * from public.record_evidence($1)", [
    JSON.stringify(record),
  ]);
export const ensurePeriod = (owner: Session, benefitId: string, on: string) =>
  owner.one("select * from public.ensure_period($1,$2)", [benefitId, on]);
export const applyReconciliation = (
  owner: Session,
  a: {
    p_request_key: string;
    p_trigger: string;
    p_periods: unknown[];
    p_evidence: unknown[];
    p_summary: unknown;
  },
) =>
  owner.one("select * from public.apply_reconciliation($1,$2,$3,$4,$5)", [
    a.p_request_key,
    a.p_trigger,
    JSON.stringify(a.p_periods),
    JSON.stringify(a.p_evidence),
    JSON.stringify(a.p_summary),
  ]);

export async function fixture(
  owner: Session,
  cadence = "monthly",
  extra: Row = {},
  onDate = "2026-10-15",
) {
  const card = await insert(owner, "cards", {
    issuer: "Synthetic Test Issuer",
    display_name: "Synthetic test card",
    last4: String(Math.floor(Math.random() * 9000) + 1000),
    status: "active",
    identity_verified_at: new Date().toISOString(),
    cardmember_anchor_date: "2020-03-15",
  });
  const benefit = await insert(owner, "benefits", {
    card_id: card.id,
    name: "Synthetic test allowance — not an entitlement",
    cadence,
    nominal_amount_cents: 1000,
    effective_from: "2020-01-01",
    issuer_source_url: "https://example.com/synthetic-test-only",
    verified_at: new Date().toISOString(),
    enabled: true,
    eligibility_status: "eligible",
    enrollment_status: "not_required",
    ...extra,
  });
  const period = await ensurePeriod(owner, benefit.id, onDate);
  return { card, benefit, period };
}
