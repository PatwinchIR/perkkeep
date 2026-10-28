import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
const testEnv = existsSync(".local/supabase.json")
  ? JSON.parse(readFileSync(".local/supabase.json", "utf8"))
  : {};
const secrets = [testEnv.SECRET_KEY, testEnv.SERVICE_ROLE_KEY].filter(Boolean);
function check(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const file = join(dir, e.name);
    if (e.isDirectory()) check(file);
    else {
      const content = readFileSync(file);
      if (secrets.some((secret) => content.includes(secret)))
        throw new Error("A privileged credential was found in browser output.");
    }
  }
}
if (!existsSync(".next/static")) throw new Error("Build the app first.");
check(".next/static");
console.log(
  "Browser output contains no local privileged Supabase credentials.",
);
