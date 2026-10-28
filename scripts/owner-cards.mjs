// Owner-run: records the owner's own cards as confirmed, from a private file that Git ignores.
// Card details never appear in this repository. Writes run as the restricted perkkeep_app role
// with the owner's identity set, exactly like the app, so RLS, guards and the audit trail apply.
//
//   node scripts/owner-cards.mjs --email you@example.com [--name "Your Name"]
//     [--cards .local/owner-cards.json] [--env .local/neon.production.env] [--app-env .local/neon.app.env]
//
// .local/owner-cards.json: [{ "catalog_key", "issuer", "display_name", "product_name", "last4" }]
import { existsSync, readFileSync } from "node:fs";
import pg from "pg";

const args = process.argv.slice(2);
const option = (name, fallback) =>
  args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const readEnv = (file) => {
  if (!existsSync(file)) throw new Error(`${file} not found.`);
  return Object.fromEntries(
    readFileSync(file, "utf8")
      .split("\n")
      .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/))
      .filter(Boolean)
      .map((m) => [m[1], m[2]]),
  );
};
const email = option("--email")?.toLowerCase();
if (!email)
  throw new Error("--email is required (your PerkKeep sign-in email).");
const name = option("--name");
const cardsFile = option("--cards", ".local/owner-cards.json");
const ownerEnv = readEnv(option("--env", ".local/neon.production.env"));
const appEnv = readEnv(option("--app-env", ".local/neon.app.env"));
const cards = JSON.parse(readFileSync(cardsFile, "utf8"));
for (const c of cards) {
  if (!c.issuer || !c.display_name)
    throw new Error("Each card needs issuer and display_name.");
  if (c.last4 != null && !/^[0-9]{4}$/.test(c.last4))
    throw new Error(`Invalid last four for ${c.display_name}.`);
}

// 1. Find the owner's Neon Auth account (it lives in the Neon Auth database, read with the owner role).
const authDb = new pg.Client({
  connectionString: ownerEnv.DATABASE_URL_UNPOOLED ?? ownerEnv.DATABASE_URL,
});
await authDb.connect();
const { rows: users } = await authDb.query(
  `select * from neon_auth."user" where lower(email) = $1`,
  [email],
);
if (users.length !== 1) {
  await authDb.end();
  throw new Error(
    "No PerkKeep account with that email yet. Sign up once at the app, verify the email, then rerun.",
  );
}
const authUser = users[0];
const verified = authUser.emailVerified ?? authUser.email_verified;
if (!verified)
  console.warn(
    "Note: this account's email is not verified yet; the app opens only after verification.",
  );
if (name) {
  await authDb.query(`update neon_auth."user" set name = $2 where id = $1`, [
    authUser.id,
    name,
  ]);
  console.log("Name on cards updated in your sign-in profile.");
}
await authDb.end();

// 2. Write the cards as the restricted app role, with the owner's identity set for this transaction.
const app = new pg.Client({ connectionString: appEnv.PERKKEEP_DATABASE_URL });
await app.connect();
try {
  const { rows } = await app.query(
    "select app.resolve_owner('neon', $1, $2) as id",
    [String(authUser.id), email],
  );
  await app.query("begin");
  await app.query("select set_config('app.owner_id', $1, true)", [rows[0].id]);
  for (const c of cards) {
    const existing = c.catalog_key
      ? (
          await app.query(
            "select id from public.cards where catalog_key = $1",
            [c.catalog_key],
          )
        ).rows[0]
      : (
          await app.query(
            "select id from public.cards where issuer = $1 and display_name = $2",
            [c.issuer, c.display_name],
          )
        ).rows[0];
    const values = [
      c.issuer,
      c.display_name,
      c.product_name ?? null,
      c.last4 ?? null,
    ];
    if (existing)
      await app.query(
        `update public.cards set issuer=$2, display_name=$3, product_name=$4, last4=$5, status='active',
           identity_verified_at=now() where id=$1`,
        [existing.id, ...values],
      );
    else
      await app.query(
        `insert into public.cards(issuer, display_name, product_name, last4, catalog_key, status, identity_verified_at)
         values ($1, $2, $3, $4, $5, 'active', now())`,
        [...values, c.catalog_key ?? null],
      );
    console.log(
      `${existing ? "Updated" : "Added"}: ${c.issuer} · ${c.display_name}${c.last4 ? ` · ending ${c.last4}` : ""}`,
    );
  }
  console.log(`${cards.length} cards saved as confirmed and active.`);
  // On the owner's instruction, link each synced account whose last four digits match exactly
  // one card, and mark the link confirmed. Anything else is listed for linking in Settings.
  const { rows: mine } = await app.query(
    "select id, last4 from public.cards where last4 is not null",
  );
  const { rows: accounts } = await app.query(
    "select id, institution, name, mask, mapping_status from public.accounts order by institution, name",
  );
  const unlinked = [];
  for (const a of accounts) {
    if (a.mapping_status === "confirmed") continue;
    const match = mine.filter((c) => a.mask && c.last4 === a.mask);
    if (match.length === 1) {
      await app.query(
        `update public.accounts set card_id=$2, proposed_card_id=$2, mapping_status='confirmed', mapping_confirmed_at=now()
         where id=$1`,
        [a.id, match[0].id],
      );
      console.log(`Linked account ${a.institution} · ${a.name}`);
    } else unlinked.push(a);
  }
  for (const a of unlinked)
    console.log(
      `Not linked (${a.mask ? "no single card with these digits" : "no last four in the account name"}): ${a.institution} · ${a.name}`,
    );
  if (!accounts.length) console.log("No synced accounts yet.");
  await app.query("commit");
  if (accounts.length)
    console.log(
      'Done. Open Settings in PerkKeep and press "Match transactions now".',
    );
} catch (e) {
  await app.query("rollback").catch(() => {});
  throw e;
} finally {
  await app.end();
}
