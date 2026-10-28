// Scans built browser assets for database connection strings and for the values of server-only
// secrets present in this environment. Prints variable names only, never values.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const local = existsSync(".local/postgres.json")
  ? JSON.parse(readFileSync(".local/postgres.json", "utf8"))
  : {};
const named = {
  ...Object.fromEntries(
    Object.entries(local).filter(([k]) => /PASSWORD|SECRET|URL/.test(k)),
  ),
  ...Object.fromEntries(
    [
      "PERKKEEP_DATABASE_URL",
      "PERKKEEP_MIGRATION_DATABASE_URL",
      "DATABASE_URL",
      "DATABASE_URL_UNPOOLED",
      "NEON_AUTH_COOKIE_SECRET",
      "PERKKEEP_TEST_AUTH_SECRET",
      "PERKKEEP_ENCRYPTION_KEY",
      "SIMPLEFIN_ACCESS_URL",
      "PLAID_SECRET",
      "CRON_SECRET",
    ]
      .filter((k) => process.env[k])
      .map((k) => [k, process.env[k]]),
  ),
};
const patterns = [/postgres(ql)?:\/\/[^\s"'`]+:[^\s"'`]+@/i, /sb_secret_/];
const findings = [];
function check(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const file = join(dir, e.name);
    if (e.isDirectory()) check(file);
    else {
      const content = readFileSync(file, "utf8");
      for (const [name, value] of Object.entries(named))
        if (value && value.length >= 12 && content.includes(value))
          findings.push(`${name} in ${file}`);
      for (const p of patterns)
        if (p.test(content)) findings.push(`${p} in ${file}`);
    }
  }
}
if (!existsSync(".next/static")) throw new Error("Build the app first.");
check(".next/static");
if (findings.length) {
  console.error(
    `Server-only credentials found in browser output:\n${findings.join("\n")}`,
  );
  process.exit(1);
}
console.log(
  `Browser output contains no connection strings and none of ${Object.keys(named).length} checked secret values.`,
);
