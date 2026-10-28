// Vercel build entry point. Production builds apply forward-only ledger migrations
// to the attached Neon database before compiling; other builds never touch it.
import { spawnSync } from "node:child_process";
import { migrate } from "./neon-migrate.mjs";

if (process.env.VERCEL_ENV === "production") {
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!url)
    throw new Error("Production builds need the attached Neon database.");
  await migrate(url);
} else {
  console.log("Skipping migrations outside production.");
}
const build = spawnSync("npx", ["next", "build"], { stdio: "inherit" });
process.exit(build.status ?? 1);
