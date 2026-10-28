// Prepares a LOCAL PostgreSQL 16+ server to mirror Neon's role model:
//   perkkeep_local_owner: migration owner, BYPASSRLS, no superuser (like neondb_owner)
//   perkkeep_app:         restricted application role, no BYPASSRLS, owns nothing
// Creates databases perkkeep_local (development) and perkkeep_test (synthetic test owners only).
// Never drops or resets anything. Usage:
//   PERKKEEP_LOCAL_ADMIN_URL=postgresql://postgres@127.0.0.1:5432/postgres npm run local:postgres
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { migrate } from "./db-migrate.mjs";

const admin = process.env.PERKKEEP_LOCAL_ADMIN_URL;
if (!admin) {
  console.error(
    "Set PERKKEEP_LOCAL_ADMIN_URL to a local PostgreSQL admin connection string.",
  );
  process.exit(1);
}
const adminUrl = new URL(admin);
if (!["localhost", "127.0.0.1", "::1"].includes(adminUrl.hostname))
  throw new Error("This script only prepares a local PostgreSQL server.");

const file = ".local/postgres.json";
const saved = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
const strong = () => `Pk_${randomBytes(24).toString("base64url")}_a9Z`;
const ownerPassword = saved.OWNER_PASSWORD ?? strong();
const appPassword = saved.APP_PASSWORD ?? strong();
const url = (user, password, db) => {
  const u = new URL(admin);
  u.username = user;
  u.password = password;
  u.pathname = `/${db}`;
  return u.toString();
};

const client = new pg.Client({ connectionString: admin });
await client.connect();
const role = await client.query(
  "select 1 from pg_roles where rolname='perkkeep_local_owner'",
);
await client.query(
  `${role.rowCount ? "alter" : "create"} role perkkeep_local_owner login bypassrls createrole nosuperuser password '${ownerPassword}'`,
);
for (const db of ["perkkeep_local", "perkkeep_test"]) {
  const exists = await client.query(
    "select 1 from pg_database where datname=$1",
    [db],
  );
  if (!exists.rowCount)
    await client.query(`create database ${db} owner perkkeep_local_owner`);
}
await client.end();

for (const db of ["perkkeep_local", "perkkeep_test"]) {
  await migrate(url("perkkeep_local_owner", ownerPassword, db), (m) =>
    console.log(`${db}: ${m}`),
  );
}
// The owner holds ADMIN on perkkeep_app (it created the role), exactly as on Neon.
const owner = new pg.Client({
  connectionString: url(
    "perkkeep_local_owner",
    ownerPassword,
    "perkkeep_local",
  ),
});
await owner.connect();
await owner.query(`alter role perkkeep_app login password '${appPassword}'`);
await owner.end();

mkdirSync(".local", { recursive: true });
const env = {
  OWNER_PASSWORD: ownerPassword,
  APP_PASSWORD: appPassword,
  OWNER_URL: url("perkkeep_local_owner", ownerPassword, "perkkeep_local"),
  APP_URL: url("perkkeep_app", appPassword, "perkkeep_local"),
  TEST_OWNER_URL: url("perkkeep_local_owner", ownerPassword, "perkkeep_test"),
  TEST_APP_URL: url("perkkeep_app", appPassword, "perkkeep_test"),
  TEST_AUTH_SECRET: saved.TEST_AUTH_SECRET ?? randomBytes(32).toString("hex"),
};
writeFileSync(file, JSON.stringify(env, null, 2), { mode: 0o600 });

// Merge local development settings into .env.local without discarding other keys.
const keep = existsSync(".env.local")
  ? readFileSync(".env.local", "utf8")
      .split("\n")
      .filter(
        (l) =>
          l &&
          !/^(PERKKEEP_DATABASE_URL|PERKKEEP_AUTH_PROVIDER|PERKKEEP_TEST_AUTH_SECRET|PERKKEEP_OWNER_EMAILS)=/.test(
            l,
          ),
      )
  : [];
writeFileSync(
  ".env.local",
  [
    ...keep,
    `PERKKEEP_DATABASE_URL=${env.APP_URL}`,
    "PERKKEEP_AUTH_PROVIDER=test",
    `PERKKEEP_TEST_AUTH_SECRET=${env.TEST_AUTH_SECRET}`,
    "PERKKEEP_OWNER_EMAILS=owner@perkkeep.test",
  ].join("\n") + "\n",
  { mode: 0o600 },
);
console.log(
  "Local PostgreSQL is ready. Connection details are in ignored .local/postgres.json and .env.local.",
);
