import "server-only";
import pg from "pg";
import { attachDatabasePool } from "@vercel/functions";

export type Owner = { neonAuthUserId: string; email: string };
export class LedgerError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

let pool: pg.Pool | null = null;
export function getPool(connectionString = process.env.DATABASE_URL) {
  if (!connectionString)
    throw new LedgerError("The ledger is not configured.", 503);
  if (!pool) {
    pool = new pg.Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    });
    if (process.env.VERCEL) attachDatabasePool(pool);
  }
  return pool;
}

/**
 * Runs `work` as the verified owner. The server connection may hold owner
 * privileges (Neon's default role has BYPASSRLS), so every request switches to the
 * restricted `authenticated` role inside its own transaction and asserts that the
 * switch took effect before any ledger query runs. The owner UUID comes only from
 * the server-verified session, never from the request body.
 */
export async function withOwner<T>(
  owner: Owner,
  work: (client: pg.PoolClient) => Promise<T>,
  db: pg.Pool = getPool(),
): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("begin");
    await client.query("set local statement_timeout = '15s'");
    const mapped = await client.query<{ id: string }>(
      `with created as (
         insert into auth.users(neon_auth_user_id, email) values ($1, $2)
         on conflict (neon_auth_user_id) do nothing returning id)
       select id from created union all
       select id from auth.users where neon_auth_user_id = $1 limit 1`,
      [owner.neonAuthUserId, owner.email.toLowerCase()],
    );
    const userId = mapped.rows[0]?.id;
    if (!userId) throw new LedgerError("Unable to resolve your account.", 500);
    await client.query("set local role authenticated");
    await client.query("select set_config('perkkeep.user_id', $1, true)", [
      userId,
    ]);
    const check = await client.query<{
      role: string;
      bypass: boolean;
      uid: string | null;
    }>(
      `select current_user as role, r.rolbypassrls as bypass, auth.uid() as uid
       from pg_catalog.pg_roles r where r.rolname = current_user`,
    );
    const row = check.rows[0];
    if (row?.role !== "authenticated" || row.bypass || row.uid !== userId)
      throw new LedgerError("Ledger security context unavailable.", 500);
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Database errors raised by ledger rules are safe to show; anything else is not. */
export function publicError(error: unknown): {
  message: string;
  status: number;
} {
  if (error instanceof LedgerError)
    return { message: error.message, status: error.status };
  const code = (error as { code?: unknown })?.code;
  if (typeof code === "string" && /^(P0001|P0002|23|22|42501)/.test(code)) {
    const message =
      code === "P0002"
        ? "That record is unavailable."
        : code === "42501"
          ? "You do not have access to that record."
          : String((error as Error).message);
    return { message, status: code === "42501" ? 403 : 400 };
  }
  return { message: "The ledger is temporarily unavailable.", status: 503 };
}
