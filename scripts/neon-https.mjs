// Owner-run: talks to production Neon over HTTPS (port 443), for machines that cannot reach Postgres
// on port 5432, such as a Claude Code cloud container. Statements run in one transaction as the
// restricted perkkeep_app role with the owner's identity set, exactly like the app, so RLS, guards
// and the audit trail apply. It never prints connection strings or secrets.
//
//   node scripts/neon-https.mjs --email you@example.com --query "select ..." [--query "..."]
//   node scripts/neon-https.mjs --email you@example.com --file statements.sql
//   node scripts/neon-https.mjs --auth [--database perkkeep] --query "select ..."   (owner role, read-only)
//
// Vercel never returns PERKKEEP_DATABASE_URL (a sensitive variable), so the app-role statements
// connect with the owner credential to the perkkeep database and run `set local role perkkeep_app`
// first; RLS, guards and audit triggers then apply as they do for the app.
//
// Credentials come from .local/neon.https.env (Git-ignored). If it is missing and VERCEL_TOKEN,
// VERCEL_ORG_ID and VERCEL_PROJECT_ID are set, the production variables are pulled into it first.
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";
import { neon } from "@neondatabase/serverless";

const ENV_FILE = ".local/neon.https.env";
const args = process.argv.slice(2);
const values = (name) =>
  args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1]] : []));
const email = values("--email")[0]?.toLowerCase();
const auth = args.includes("--auth");
const database = values("--database")[0];
const statements = [
  ...values("--query"),
  ...values("--file").flatMap((f) =>
    readFileSync(f, "utf8")
      .split(/;\s*\n/)
      .map((s) => s.trim())
      .filter(Boolean),
  ),
];
if (!statements.length && !args.includes("--setup-role"))
  throw new Error("Pass --query or --file.");
if (!auth && !email && !args.includes("--setup-role"))
  throw new Error("--email is required (the owner's sign-in email).");

if (!existsSync(ENV_FILE)) {
  const { VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID } = process.env;
  if (!VERCEL_TOKEN || !VERCEL_ORG_ID || !VERCEL_PROJECT_ID)
    throw new Error(
      `${ENV_FILE} not found, and VERCEL_TOKEN, VERCEL_ORG_ID and VERCEL_PROJECT_ID are not all set.`,
    );
  mkdirSync(".local", { recursive: true, mode: 0o700 });
  execFileSync(
    "npx",
    [
      "--yes",
      "vercel@65.5.0",
      "env",
      "pull",
      ENV_FILE,
      "--environment",
      "production",
      "--yes",
      "--token",
      VERCEL_TOKEN,
    ],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  chmodSync(ENV_FILE, 0o600);
}
const env = Object.fromEntries(
  readFileSync(ENV_FILE, "utf8")
    .split("\n")
    .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);
// Honors HTTPS_PROXY where one is set (cloud containers); connects directly elsewhere.
setGlobalDispatcher(new EnvHttpProxyAgent());
const print = (label, rows) =>
  console.log(JSON.stringify({ statement: label, rows }, null, 1));

const ownerUrl = env.DATABASE_URL_UNPOOLED ?? env.DATABASE_URL;
const onDatabase = (name) => {
  const u = new URL(ownerUrl);
  u.pathname = `/${name}`;
  return u.toString();
};
const authDb = neon(ownerUrl);
if (args.includes("--setup-role")) {
  // One-time: lets the owner switch into perkkeep_app without inheriting its privileges.
  // Undo with: revoke perkkeep_app from neondb_owner.
  const db = neon(onDatabase(database ?? "perkkeep"));
  await db.query(
    "grant perkkeep_app to current_user with inherit false, set true",
  );
  print(
    "grant perkkeep_app (set only)",
    await db.query(
      `select set_option, inherit_option, admin_option from pg_auth_members
     where roleid='perkkeep_app'::regrole and member=current_user::regrole`,
    ),
  );
  process.exit(0);
}
if (auth) {
  // Read-only: the owner role can bypass RLS, so it never writes here.
  const db = database ? neon(onDatabase(database)) : authDb;
  const results = await db.transaction(
    statements.map((s) => db.query(s)),
    { readOnly: true },
  );
  results.forEach((rows, i) => print(statements[i], rows));
} else {
  const users = await authDb.query(
    `select id from neon_auth."user" where lower(email) = $1`,
    [email],
  );
  if (users.length !== 1)
    throw new Error("No single Neon Auth account has that email.");
  const direct = /^postgres(ql)?:\/\//.test(env.PERKKEEP_DATABASE_URL ?? "");
  const app = neon(
    direct ? env.PERKKEEP_DATABASE_URL : onDatabase(database ?? "perkkeep"),
  );
  const asApp = direct ? [] : [app.query("set local role perkkeep_app")];
  const [, { id: ownerId }] = await app
    .transaction([
      ...asApp,
      app.query("select app.resolve_owner('neon', $1, $2) as id", [
        String(users[0].id),
        email,
      ]),
    ])
    .then((r) => [null, r.at(-1)[0]]);
  const results = await app.transaction([
    ...asApp,
    app.query("select current_user as role, current_database() as db"),
    app.query("select set_config('app.owner_id', $1, true)", [ownerId]),
    ...statements.map((s) => app.query(s)),
  ]);
  const [who] = results[asApp.length];
  if (who.role !== "perkkeep_app")
    throw new Error(`Refusing to continue: running as ${who.role}.`);
  results
    .slice(asApp.length + 2)
    .forEach((rows, i) => print(statements[i], rows));
}
