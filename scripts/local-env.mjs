import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
const result = JSON.parse(
  execFileSync("npx", ["supabase", "status", "--output-format", "json"], {
    encoding: "utf8",
  }),
);
const env = result.env;
if (!env || !["localhost", "127.0.0.1"].includes(new URL(env.API_URL).hostname))
  throw new Error("Local stack required");
mkdirSync(".local", { recursive: true });
writeFileSync(".local/supabase.json", JSON.stringify(env), { mode: 0o600 });
writeFileSync(
  ".env.local",
  `NEXT_PUBLIC_SUPABASE_URL=${env.API_URL}\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${env.PUBLISHABLE_KEY}\n`,
  { mode: 0o600 },
);
console.log(
  "Local browser configuration saved. Test credentials stay in ignored .local files.",
);
