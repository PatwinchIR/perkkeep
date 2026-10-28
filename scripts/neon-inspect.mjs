// Read-only look at a Neon database before migrating it. Prints schema and table names, the
// migration history table's columns and rows, row counts, and PerkKeep role attributes. It never
// prints connection strings or table contents, and it changes nothing.
//
//   node scripts/neon-inspect.mjs [--env .local/neon.production.env]
import { existsSync, readFileSync } from "node:fs";
import pg from "pg";

const args = process.argv.slice(2);
const envFile = args.includes("--env")
  ? args[args.indexOf("--env") + 1]
  : ".local/neon.production.env";
if (!existsSync(envFile)) throw new Error(`${envFile} not found.`);
const env = Object.fromEntries(
  readFileSync(envFile, "utf8")
    .split("\n")
    .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);
const url =
  env.DATABASE_URL_UNPOOLED ?? env.POSTGRES_URL_NON_POOLING ?? env.DATABASE_URL;
if (!url) throw new Error(`No owner connection variable in ${envFile}.`);

const client = new pg.Client({ connectionString: url });
await client.connect();
const q = async (sql) => (await client.query(sql)).rows;
try {
  await client.query("set default_transaction_read_only = on");
  const tables = await q(
    `select table_schema, table_name, table_type from information_schema.tables
     where table_schema not in ('pg_catalog','information_schema') order by 1, 2`,
  );
  console.log("Tables and views:");
  console.table(tables);
  const counts = [];
  for (const t of tables.filter((t) => t.table_type === "BASE TABLE"))
    counts.push({
      table: `${t.table_schema}.${t.table_name}`,
      rows: (
        await q(
          `select count(*)::int as n from "${t.table_schema}"."${t.table_name}"`,
        )
      )[0].n,
    });
  console.log("Row counts (numbers only):");
  console.table(counts);
  console.log("perkkeep_meta.schema_migrations columns:");
  console.table(
    await q(
      `select column_name, data_type from information_schema.columns
       where table_schema='perkkeep_meta' and table_name='schema_migrations' order by ordinal_position`,
    ),
  );
  if (
    tables.some(
      (t) =>
        t.table_schema === "perkkeep_meta" &&
        t.table_name === "schema_migrations",
    )
  ) {
    console.log("perkkeep_meta.schema_migrations rows:");
    console.table(await q("select * from perkkeep_meta.schema_migrations"));
  }
  console.log("Roles:");
  console.table(
    await q(
      `select rolname, rolcanlogin, rolbypassrls, rolsuper from pg_roles
       where rolname like 'perkkeep%' or rolname = current_user order by 1`,
    ),
  );
  console.log("Functions in app and private schemas:");
  console.table(
    await q(
      `select n.nspname as schema, p.proname as name from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname in ('app','private') order by 1, 2`,
    ),
  );
} finally {
  await client.end();
}
