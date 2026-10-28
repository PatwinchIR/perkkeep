// Owner-run: links synced accounts to cards and runs the matchers against production, using the
// app's own code (linkAccounts, runMatchers) in one interactive transaction as perkkeep_app with
// the owner's identity set. It connects over Neon's WebSocket endpoint on port 443, so it works
// where port 5432 is blocked. Credentials come from .local/neon.https.env (see neon-https.mjs).
//
//   npm run neon:reconcile -- --email you@example.com [--dry-run]
import { readFileSync } from "node:fs";
import { EnvHttpProxyAgent, setGlobalDispatcher, WebSocket } from "undici";
import { neonConfig, Pool, types } from "@neondatabase/serverless";
import type { Tx } from "../src/server/db";
import { linkAccounts } from "../src/server/sources/sync";
import { runMatchers } from "../src/server/matchers";

const args = process.argv.slice(2);
const email = args[args.indexOf("--email") + 1]?.toLowerCase();
if (!args.includes("--email") || !email)
  throw new Error("--email is required (the owner's sign-in email).");
const dryRun = args.includes("--dry-run");
const env = Object.fromEntries(
  readFileSync(".local/neon.https.env", "utf8")
    .split("\n")
    .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => [m[1], m[2]]),
);

// Same value shapes as src/server/pg-types.ts, so the app code sees what it sees in production.
types.setTypeParser(1082, (v: string) => v);
const parseTimestamp = types.getTypeParser(1184);
types.setTypeParser(1184, (v: string) =>
  (parseTimestamp(v) as Date).toISOString(),
);
types.setTypeParser(20, (v: string) => Number(v));
// Honors HTTPS_PROXY where one is set (cloud containers); connects directly elsewhere.
setGlobalDispatcher(new EnvHttpProxyAgent());
neonConfig.webSocketConstructor = WebSocket;

const ownerUrl = env.DATABASE_URL_UNPOOLED ?? env.DATABASE_URL;
const onDatabase = (name: string) => {
  const u = new URL(ownerUrl);
  u.pathname = `/${name}`;
  return u.toString();
};
const authPool = new Pool({ connectionString: ownerUrl });
const { rows: users } = await authPool.query(
  `select id from neon_auth."user" where lower(email) = $1`,
  [email],
);
await authPool.end();
if (users.length !== 1)
  throw new Error("No single Neon Auth account has that email.");

const pool = new Pool({ connectionString: onDatabase("perkkeep") });
const client = await pool.connect();
try {
  await client.query("begin");
  await client.query("set local role perkkeep_app");
  const { rows: who } = await client.query("select current_user as role");
  if (who[0].role !== "perkkeep_app")
    throw new Error(`Refusing to continue: running as ${who[0].role}.`);
  const { rows } = await client.query(
    "select app.resolve_owner('neon', $1, $2) as id",
    [String(users[0].id), email],
  );
  await client.query("select set_config('app.owner_id', $1, true)", [
    rows[0].id,
  ]);
  const tx = client as unknown as Tx;
  await linkAccounts(tx);
  const matched = await runMatchers(tx, "manual");
  const { rows: accounts } = await client.query(
    `select a.institution, a.name, a.mapping_status, c.display_name as card
     from public.accounts a left join public.cards c on c.id=a.card_id
     order by a.mapping_status, a.institution, a.name`,
  );
  console.table(accounts);
  console.log("Matching:", JSON.stringify(matched));
  await client.query(dryRun ? "rollback" : "commit");
  console.log(dryRun ? "Dry run: nothing was saved." : "Saved.");
} catch (e) {
  await client.query("rollback").catch(() => {});
  throw e;
} finally {
  client.release();
  await pool.end();
}
