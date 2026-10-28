import type { NextConfig } from "next";
// Deployment guard: refuse to build a Vercel deployment that could serve user queries with the
// database owner, run the local test sign-in, or leak a connection string to the browser.
if (process.env.VERCEL) {
  const problems: string[] = [];
  const appUrl = process.env.PERKKEEP_DATABASE_URL;
  const ownerUrls = [
    process.env.DATABASE_URL,
    process.env.DATABASE_URL_UNPOOLED,
    process.env.POSTGRES_URL,
    process.env.POSTGRES_URL_NON_POOLING,
  ].filter(Boolean);
  if (!appUrl) problems.push("PERKKEEP_DATABASE_URL is missing");
  else {
    const u = new URL(appUrl);
    if (["localhost", "127.0.0.1"].includes(u.hostname))
      problems.push("PERKKEEP_DATABASE_URL points to a local database");
    if (!u.username.startsWith("perkkeep_app") || ownerUrls.includes(appUrl))
      problems.push(
        "PERKKEEP_DATABASE_URL must use the restricted perkkeep_app role",
      );
  }
  const authUrl = process.env.NEON_AUTH_BASE_URL;
  if (!authUrl || new URL(authUrl).protocol !== "https:")
    problems.push("NEON_AUTH_BASE_URL must be an HTTPS URL");
  if ((process.env.NEON_AUTH_COOKIE_SECRET ?? "").length < 32)
    problems.push("NEON_AUTH_COOKIE_SECRET must have at least 32 characters");
  if (!process.env.PERKKEEP_OWNER_EMAILS?.trim())
    problems.push("PERKKEEP_OWNER_EMAILS is empty, so nobody could sign in");
  if (Buffer.from(process.env.PERKKEEP_ENCRYPTION_KEY ?? "", "base64").length !== 32)
    problems.push("PERKKEEP_ENCRYPTION_KEY must be 32 base64-encoded bytes");
  if ((process.env.CRON_SECRET ?? "").length < 32)
    problems.push("CRON_SECRET must have at least 32 characters");
  if ((process.env.PERKKEEP_AUTH_PROVIDER ?? "neon") !== "neon")
    problems.push("PERKKEEP_AUTH_PROVIDER must be neon on Vercel");
  for (const [name, value] of Object.entries(process.env))
    if (
      name.startsWith("NEXT_PUBLIC_") &&
      /postgres(ql)?:\/\//i.test(value ?? "")
    )
      problems.push(`${name} exposes a database connection string`);
  if (problems.length)
    throw new Error(
      `PerkKeep deployment configuration is unsafe: ${problems.join("; ")}.`,
    );
}
const config: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          {
            key: "Content-Security-Policy",
            value: "default-src 'self'; script-src 'self'",
          },
        ],
      },
    ];
  },
};
export default config;
