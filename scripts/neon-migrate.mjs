// Applies forward-only ledger migrations to Neon (or a local PostgreSQL test
// database). Never resets, drops or rewrites existing data. Prints file names only.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = fileURLToPath(new URL("..", import.meta.url));
const LOCK = 4_726_517_201;

export function migrationFiles() {
  const list = (dir, prefix) =>
    readdirSync(join(root, dir))
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => ({ name: `${prefix}/${f}`, path: join(root, dir, f) }));
  const neon = list("db/neon", "neon");
  return [
    ...neon.filter((m) => m.name < "neon/5000"),
    ...list("db/migrations", "ledger"),
    ...neon.filter((m) => m.name >= "neon/5000"),
  ];
}

// Shared migration files carry their own begin/commit. They are stripped so the
// file and its tracking row commit atomically in one transaction.
function body(sql) {
  return sql
    .split("\n")
    .filter((line) => !/^\s*(begin|commit);\s*$/i.test(line))
    .join("\n");
}

export async function migrate(connectionString, log = console.log) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [LOCK]);
    await client.query(`create schema if not exists perkkeep_meta;
      create table if not exists perkkeep_meta.schema_migrations(
        name text primary key, checksum text not null, applied_at timestamptz not null default now())`);
    const applied = new Map(
      (
        await client.query(
          "select name, checksum from perkkeep_meta.schema_migrations",
        )
      ).rows.map((r) => [r.name, r.checksum]),
    );
    let count = 0;
    for (const file of migrationFiles()) {
      const sql = readFileSync(file.path, "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      if (applied.has(file.name)) {
        if (applied.get(file.name) !== checksum)
          throw new Error(
            `${file.name} changed after it was applied. Add a new forward migration instead.`,
          );
        continue;
      }
      await client.query("begin");
      try {
        await client.query(body(sql));
        await client.query(
          "insert into perkkeep_meta.schema_migrations(name, checksum) values($1, $2)",
          [file.name, checksum],
        );
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw new Error(`${file.name} failed: ${error.message}`);
      }
      log(`Applied ${file.name}`);
      count++;
    }
    log(count ? `${count} migration(s) applied.` : "Schema is up to date.");
  } finally {
    await client
      .query("select pg_advisory_unlock($1)", [LOCK])
      .catch(() => undefined);
    await client.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url =
    process.env.MIGRATION_DATABASE_URL ??
    process.env.DATABASE_URL_UNPOOLED ??
    process.env.DATABASE_URL;
  if (!url) {
    console.error("No database URL configured for migrations.");
    process.exit(1);
  }
  migrate(url).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
