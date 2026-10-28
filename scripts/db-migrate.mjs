// Applies db/migrations/*.sql in order as the database owner. Each file runs once, in its own
// transaction, and is recorded with its SHA-256. A changed file that was already applied is refused:
// write a new forward migration instead. Never prints connection strings.
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";

const dir = fileURLToPath(new URL("../db/migrations/", import.meta.url));

export async function migrate(connectionString, log = console.log) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query(
      "select pg_advisory_lock(hashtext('perkkeep_migrations'))",
    );
    await client.query(
      "create schema if not exists perkkeep_meta; create table if not exists perkkeep_meta.schema_migrations(name text primary key, sha256 text not null, applied_at timestamptz not null default now())",
    );
    await client.query("revoke all on schema perkkeep_meta from public");
    const applied = new Map(
      (
        await client.query(
          "select name, sha256 from perkkeep_meta.schema_migrations",
        )
      ).rows.map((r) => [r.name, r.sha256]),
    );
    for (const name of readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()) {
      const sql = readFileSync(dir + name, "utf8");
      const sha = createHash("sha256").update(sql).digest("hex");
      if (applied.has(name)) {
        if (applied.get(name) !== sha)
          throw new Error(
            `${name} changed after it was applied. Add a new migration instead.`,
          );
        continue;
      }
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query(
          "insert into perkkeep_meta.schema_migrations(name, sha256) values ($1, $2)",
          [name, sha],
        );
        await client.query("commit");
        log(`Applied ${name}`);
      } catch (e) {
        await client.query("rollback");
        throw new Error(`${name} failed and was rolled back: ${e.message}`);
      }
    }
  } finally {
    await client.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const name = process.argv[2] ?? "PERKKEEP_MIGRATION_DATABASE_URL";
  const url = process.env[name];
  if (!url) {
    console.error(
      `Set ${name} to the database owner connection string (never commit it).`,
    );
    process.exit(1);
  }
  migrate(url)
    .then(() => console.log("Migrations are up to date."))
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
