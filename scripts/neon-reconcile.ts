// Owner-run: links synced accounts to cards, optionally imports a statement export and runs
// named ledger operations, then runs the matchers against production, using the app's own code
// (linkAccounts, importStatement, runOperation, runMatchers) in one interactive transaction as
// perkkeep_app with the owner's identity set. It connects over Neon's WebSocket endpoint on port
// 443, so it works where port 5432 is blocked. Credentials come from .local/neon.https.env (see
// neon-https.mjs).
//
//   npm run neon:reconcile -- --email you@example.com [--add-researched] [--dry-run]
//       [--import path/to/export.csv] [--op <ledger operation> --input-file path/to/input.json]...
//
// --add-researched adds each confirmed card's researched benefits (data/benefits) first, as the
// card page's "Add researched benefits" button does.
// --import imports a statement CSV exactly as Settings does (D23, D53): a Copilot Money export is
// split by account and matched to cards by last four digits. The file is read here and never
// stored; only its parsed rows reach the ledger.
// --op runs one named ledger operation (src/server/ledger.ts) with the JSON object in the file,
// so card digits and identifiers stay off the command line. Repeat the pair for several.
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { EnvHttpProxyAgent, setGlobalDispatcher, WebSocket } from "undici";
import { neonConfig, Pool, types } from "@neondatabase/serverless";
import type { Tx } from "../src/server/db";
import { linkAccounts } from "../src/server/sources/sync";
import { importStatement } from "../src/server/sources/import";
import { runMatchers } from "../src/server/matchers";
import {
  addResearchedBenefits,
  operations,
  runOperation,
  type Operation,
} from "../src/server/ledger";

const args = process.argv.slice(2);
const email = args[args.indexOf("--email") + 1]?.toLowerCase();
if (!args.includes("--email") || !email)
  throw new Error("--email is required (the owner's sign-in email).");
const dryRun = args.includes("--dry-run");
const importPath = args.includes("--import")
  ? args[args.indexOf("--import") + 1]
  : undefined;
if (args.includes("--import") && !importPath)
  throw new Error("--import needs a file path.");
const ops: { op: Operation; input: unknown }[] = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] !== "--op") continue;
  const op = args[i + 1] as Operation;
  const fileFlag = args.indexOf("--input-file", i + 2);
  if (!op || !(op in operations) || fileFlag < 0 || !args[fileFlag + 1])
    throw new Error(
      "--op needs a ledger operation name followed by --input-file <path>.",
    );
  ops.push({ op, input: JSON.parse(readFileSync(args[fileFlag + 1], "utf8")) });
}
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
  if (args.includes("--add-researched")) {
    const { rows: cards } = await client.query(
      "select id, display_name from public.cards where status='active' and identity_verified_at is not null order by display_name",
    );
    for (const c of cards) {
      const r = await addResearchedBenefits(tx, c.id);
      if (r.added.length || r.skipped.length)
        console.log(
          `${c.display_name}: added ${r.added.join(", ") || "none"}; skipped ${r.skipped.join(", ") || "none"}`,
        );
    }
  }
  for (const { op, input } of ops) {
    const result = (await runOperation(tx, op, input)) as Record<
      string,
      unknown
    >;
    console.log(
      `${op}: ${result && typeof result === "object" && "id" in result ? `record ${String(result.id)}` : "done"}`,
    );
    // classifyMemberships lists what it changed: benefit names and activation dates only.
    if (Array.isArray(result?.classified))
      console.table(
        (
          result.classified as {
            name: string;
            activated_on: string;
            activation_assumed: boolean;
          }[]
        ).map((r) => ({
          benefit: r.name,
          activated_on: r.activated_on,
          assumed: r.activation_assumed,
        })),
      );
  }
  if (importPath) {
    const imported = await importStatement(tx, {
      file_name: basename(importPath).slice(0, 200),
      file_text: readFileSync(importPath, "utf8"),
    });
    console.log(`Import (${imported.format.label}):`);
    if ("accounts" in imported)
      // Digits are left out on purpose: this output lands in terminals and transcripts.
      console.table(
        imported.accounts.map((a) => ({
          account: a.account,
          card: a.card ?? "",
          status: a.status,
          rows: a.rows,
          added: a.added,
          unchanged: a.unchanged,
          left_to_sync: a.left_to_sync,
          coverage: a.coverage_start
            ? `${a.coverage_start} to ${a.coverage_end}`
            : "",
          reason: a.reason ?? "",
        })),
      );
    else
      console.log(
        `  ${imported.added} rows added, ${imported.unchanged} unchanged${imported.replay ? " (replay)" : ""}`,
      );
    console.log("Matching after import:", JSON.stringify(imported.matched));
  }
  const matched = await runMatchers(tx, "manual");
  const { rows: accounts } = await client.query(
    `select a.institution, a.name, a.mapping_status, c.display_name as card
     from public.accounts a left join public.cards c on c.id=a.card_id
     order by a.mapping_status, a.institution, a.name`,
  );
  console.table(accounts);
  console.log("Matching:", JSON.stringify(matched));
  // What the ledger now holds per benefit period: totals only, no transaction rows.
  const { rows: progress } = await client.query(
    `select c.display_name as card, b.name as benefit, p.period_start, p.period_end_exclusive, p.coverage_status,
            p.allowance_cents,
            coalesce(sum(e.amount_cents) filter (where e.confidence='confirmed'),0)::int as confirmed_cents,
            coalesce(sum(e.amount_cents) filter (where e.confidence='candidate'),0)::int as candidate_cents,
            count(e.id)::int as evidence_rows
     from public.benefit_periods p
     join public.benefits b on b.id=p.benefit_id join public.cards c on c.id=b.card_id
     left join public.redemption_evidence e on e.benefit_period_id=p.id
       and not exists(select 1 from public.redemption_evidence l where l.supersedes_evidence_id=e.id)
     where b.enabled
     group by c.display_name, b.name, p.period_start, p.period_end_exclusive, p.coverage_status, p.allowance_cents
     order by c.display_name, b.name, p.period_start`,
  );
  console.table(progress);
  await client.query(dryRun ? "rollback" : "commit");
  console.log(dryRun ? "Dry run: nothing was saved." : "Saved.");
} catch (e) {
  await client.query("rollback").catch(() => {});
  throw e;
} finally {
  client.release();
  await pool.end();
}
