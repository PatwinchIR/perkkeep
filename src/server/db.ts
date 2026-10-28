import "server-only";
import pg from "./pg-types";
import { attachDatabasePool } from "@vercel/functions";

export type Tx = pg.PoolClient;
let pool: pg.Pool | null = null;
let verified: Promise<void> | null = null;

export function databaseUrl(): string {
  const url = process.env.PERKKEEP_DATABASE_URL;
  if (!url) throw new Error("PERKKEEP_DATABASE_URL is not configured.");
  return url;
}

function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: databaseUrl(),
      max: 5,
      idleTimeoutMillis: 10000,
    });
    attachDatabasePool(pool);
  }
  return pool;
}

// Refuse to serve requests on a connection that could bypass row-level security.
async function verifyRestrictedRole(client: Tx) {
  const { rows } = await client.query<{
    rolsuper: boolean;
    rolbypassrls: boolean;
    owned: number;
  }>(
    `select r.rolsuper, r.rolbypassrls,
       (select count(*) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
        where n.nspname in ('public','app','private') and c.relowner=r.oid)::int as owned
     from pg_catalog.pg_roles r where r.rolname=current_user`,
  );
  const role = rows[0];
  if (!role || role.rolsuper || role.rolbypassrls || role.owned > 0)
    throw new Error(
      "PERKKEEP_DATABASE_URL must use the restricted perkkeep_app role, never the database owner.",
    );
}

async function connect(): Promise<Tx> {
  const client = await getPool().connect();
  try {
    verified ??= verifyRestrictedRole(client).catch((e) => {
      verified = null;
      throw e;
    });
    await verified;
    return client;
  } catch (e) {
    client.release();
    throw e;
  }
}

// Every query for a person runs in one transaction whose identity setting is transaction-local,
// so a pooled connection never carries one owner's identity into another request.
export async function withOwner<T>(
  ownerId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const client = await connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.owner_id', $1, true)", [
      ownerId,
    ]);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// Maps a verified identity to its owner row. Called only after server-side session checks.
export async function resolveOwner(
  provider: "neon" | "test",
  subject: string,
  email: string,
) {
  const client = await connect();
  try {
    const { rows } = await client.query<{ id: string }>(
      "select app.resolve_owner($1, $2, $3) as id",
      [provider, subject, email],
    );
    return rows[0].id;
  } finally {
    client.release();
  }
}

export async function closePool() {
  await pool?.end();
  pool = null;
  verified = null;
}
