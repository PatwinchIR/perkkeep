// Owner-run: applies db/migrations to production Neon over its WebSocket endpoint (port 443), for
// machines that cannot reach Postgres on port 5432, such as a Claude Code cloud container. It is
// the same runner as db-migrate.mjs: each file runs once, in its own transaction, as the database
// owner, and is recorded with its SHA-256; a changed file that was already applied is refused.
//
//   npm run neon:migrate [-- --database perkkeep]
//
// Credentials come from .local/neon.https.env or .local/neon.production.env (both Git-ignored,
// both written by `vercel env pull`). If neither exists and VERCEL_TOKEN, VERCEL_ORG_ID and
// VERCEL_PROJECT_ID are set, the production variables are pulled first. Never prints connection
// strings or secrets. Unlike neon:provision, this never touches the perkkeep_app role or its password.
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { neonConfig, Client } from "@neondatabase/serverless";
import { migrateWith } from "./db-migrate.mjs";

const ENV_FILES = [".local/neon.https.env", ".local/neon.production.env"];
const args = process.argv.slice(2);
const database = args[args.indexOf("--database") + 1];
const ENV_FILE = ENV_FILES.find((f) => existsSync(f)) ?? ENV_FILES[0];
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
// Behind HTTPS_PROXY (cloud containers) the WebSocket goes through undici's proxy agent; elsewhere
// Node's own WebSocket (Node 22 and later) is enough, so a plain checkout needs nothing extra.
if (process.env.HTTPS_PROXY || process.env.https_proxy) {
  const { EnvHttpProxyAgent, setGlobalDispatcher, WebSocket } =
    await import("undici");
  setGlobalDispatcher(new EnvHttpProxyAgent());
  neonConfig.webSocketConstructor = WebSocket;
} else if (typeof globalThis.WebSocket !== "function") {
  const { WebSocket } = await import("undici");
  neonConfig.webSocketConstructor = WebSocket;
}
// Migrations need a direct connection: session advisory locks do not survive transaction pooling.
const url = new URL(env.DATABASE_URL_UNPOOLED ?? env.DATABASE_URL);
url.pathname = `/${args.includes("--database") && database ? database : "perkkeep"}`;
const client = new Client({ connectionString: url.toString() });
await client.connect();
try {
  const { rows } = await client.query(
    "select current_database() as db, current_user as role, (select rolbypassrls from pg_roles where rolname=current_user) as bypass",
  );
  console.log(
    `Connected to ${rows[0].db} as ${rows[0].role} (bypassrls: ${rows[0].bypass}).`,
  );
  await migrateWith(client, (m) => console.log(m));
  console.log("Migrations are up to date on Neon.");
} finally {
  await client.end();
}
