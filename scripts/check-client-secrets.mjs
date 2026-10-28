import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
// Fails if browser output contains a privileged credential or any database URL.
const secrets = [
  process.env.DATABASE_URL,
  process.env.DATABASE_URL_UNPOOLED,
  process.env.NEON_AUTH_COOKIE_SECRET,
  process.env.PGPASSWORD,
].filter((s) => typeof s === "string" && s.length >= 8);
const patterns = [/postgres(?:ql)?:\/\/[^\s"'`]+@/i];
function check(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const file = join(dir, e.name);
    if (e.isDirectory()) check(file);
    else {
      const content = readFileSync(file, "utf8");
      if (
        secrets.some((secret) => content.includes(secret)) ||
        patterns.some((p) => p.test(content))
      )
        throw new Error(`A privileged credential was found in ${file}.`);
    }
  }
}
if (!existsSync(".next/static")) throw new Error("Build the app first.");
check(".next/static");
console.log(
  "Browser output contains no database URLs or privileged credentials.",
);
