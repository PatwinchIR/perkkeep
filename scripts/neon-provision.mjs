// Owner-run Neon setup. Reads the owner connection from an ignored env file, applies migrations,
// sets a strong password on the restricted perkkeep_app role, and writes the restricted pooled URL
// to .local/neon.app.env. With --vercel it also stores the server-only variables in the linked
// Vercel project through the Vercel CLI (values go through stdin, never argv or logs).
//
//   node scripts/neon-provision.mjs [--env .local/neon.production.env] [--vercel] [--owner-email you@example.com]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import pg from "pg";
import { migrate } from "./db-migrate.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) =>
  args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const envFile = option("--env") ?? ".local/neon.production.env";
if (!existsSync(envFile)) throw new Error(`${envFile} not found.`);
const env = Object.fromEntries(
  readFileSync(envFile, "utf8")
    .split("\n")
    .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);
const direct =
  env.DATABASE_URL_UNPOOLED ?? env.POSTGRES_URL_NON_POOLING ?? env.DATABASE_URL;
const pooled = env.DATABASE_URL ?? env.POSTGRES_URL ?? direct;
if (!direct)
  throw new Error(
    `No owner connection variable found in ${envFile} (checked by name only).`,
  );

// Migrations need a direct connection: session advisory locks do not survive transaction pooling.
await migrate(direct);
// Neon asks for mixed character classes in SQL-set passwords; 192 random bits plus fixed classes.
const password = `Pk_${randomBytes(24).toString("base64url")}_a9Z`;
const client = new pg.Client({ connectionString: direct });
await client.connect();
const [{ rolbypassrls }] = (
  await client.query(
    "select rolbypassrls from pg_roles where rolname=current_user",
  )
).rows;
if (!rolbypassrls)
  console.warn(
    "Note: the owner role does not have BYPASSRLS on this database.",
  );
await client.query(`alter role perkkeep_app login password '${password}'`);
await client.end();

const app = new URL(pooled);
app.username = "perkkeep_app";
app.password = password;
const appUrl = app.toString();
// Prove the restricted role connects and cannot bypass row-level security.
const check = new pg.Client({ connectionString: appUrl });
await check.connect();
const role = (
  await check.query(
    "select current_user, rolbypassrls, rolsuper from pg_roles where rolname=current_user",
  )
).rows[0];
const visible = (
  await check.query("select count(*)::int as n from public.cards")
).rows[0].n;
await check.end();
if (role.rolbypassrls || role.rolsuper || visible !== 0)
  throw new Error("perkkeep_app is not restricted as expected. Do not deploy.");
writeFileSync(".local/neon.app.env", `PERKKEEP_DATABASE_URL=${appUrl}\n`, {
  mode: 0o600,
});
console.log(
  "Restricted role verified: no BYPASSRLS, no superuser, sees 0 rows without an identity.",
);
console.log(
  "Saved PERKKEEP_DATABASE_URL to .local/neon.app.env (owner-only permissions).",
);

if (flag("--vercel")) {
  const owner = option("--owner-email");
  if (!owner)
    throw new Error(
      "--vercel needs --owner-email so that someone can sign in.",
    );
  const values = {
    PERKKEEP_DATABASE_URL: appUrl,
    PERKKEEP_OWNER_EMAILS: owner.toLowerCase(),
    NEON_AUTH_COOKIE_SECRET:
      env.NEON_AUTH_COOKIE_SECRET ?? randomBytes(32).toString("base64url"),
    PERKKEEP_ENCRYPTION_KEY:
      env.PERKKEEP_ENCRYPTION_KEY ?? randomBytes(32).toString("base64"),
    CRON_SECRET: env.CRON_SECRET ?? randomBytes(32).toString("base64url"),
  };
  for (const [name, value] of Object.entries(values)) {
    for (const target of ["production"]) {
      const r = spawnSync("vercel", ["env", "add", name, target], {
        input: value,
        encoding: "utf8",
      });
      console.log(
        `${name} (${target}): ${r.status === 0 ? "saved" : "not saved, it may already exist"}`,
      );
    }
  }
}
