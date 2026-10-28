import type { NextConfig } from "next";
// Deployment guard. Any Vercel build fails on an unsafe setting: an owner-role or local database
// URL, the local test sign-in, a weak secret, or a connection string in a NEXT_PUBLIC_ variable.
// Production builds also fail when a required setting is missing; previews without settings build
// and show the setup screen, because they cannot open any data.
if (process.env.VERCEL) {
  const unsafe: string[] = [];
  const missing: string[] = [];
  const env = process.env;
  const ownerUrls = [
    env.DATABASE_URL,
    env.DATABASE_URL_UNPOOLED,
    env.POSTGRES_URL,
    env.POSTGRES_URL_NON_POOLING,
  ].filter(Boolean);
  if (!env.PERKKEEP_DATABASE_URL) missing.push("PERKKEEP_DATABASE_URL");
  else {
    const u = new URL(env.PERKKEEP_DATABASE_URL);
    if (["localhost", "127.0.0.1"].includes(u.hostname))
      unsafe.push("PERKKEEP_DATABASE_URL points to a local database");
    if (
      !u.username.startsWith("perkkeep_app") ||
      ownerUrls.includes(env.PERKKEEP_DATABASE_URL)
    )
      unsafe.push(
        "PERKKEEP_DATABASE_URL must use the restricted perkkeep_app role",
      );
  }
  if (!env.NEON_AUTH_BASE_URL) missing.push("NEON_AUTH_BASE_URL");
  else if (new URL(env.NEON_AUTH_BASE_URL).protocol !== "https:")
    unsafe.push("NEON_AUTH_BASE_URL must be an HTTPS URL");
  if (!env.NEON_AUTH_COOKIE_SECRET) missing.push("NEON_AUTH_COOKIE_SECRET");
  else if (env.NEON_AUTH_COOKIE_SECRET.length < 32)
    unsafe.push("NEON_AUTH_COOKIE_SECRET must have at least 32 characters");
  if (!env.PERKKEEP_OWNER_EMAILS?.trim()) missing.push("PERKKEEP_OWNER_EMAILS");
  if (!env.PERKKEEP_ENCRYPTION_KEY) missing.push("PERKKEEP_ENCRYPTION_KEY");
  else if (Buffer.from(env.PERKKEEP_ENCRYPTION_KEY, "base64").length !== 32)
    unsafe.push("PERKKEEP_ENCRYPTION_KEY must be 32 base64-encoded bytes");
  if (!env.CRON_SECRET) missing.push("CRON_SECRET");
  else if (env.CRON_SECRET.length < 32)
    unsafe.push("CRON_SECRET must have at least 32 characters");
  if ((env.PERKKEEP_AUTH_PROVIDER ?? "neon") !== "neon")
    unsafe.push("PERKKEEP_AUTH_PROVIDER must be neon on Vercel");
  for (const [name, value] of Object.entries(env))
    if (
      name.startsWith("NEXT_PUBLIC_") &&
      /postgres(ql)?:\/\//i.test(value ?? "")
    )
      unsafe.push(`${name} exposes a database connection string`);
  const problems = [
    ...unsafe,
    ...(env.VERCEL_ENV === "production" && missing.length
      ? [`missing ${missing.join(", ")}`]
      : []),
  ];
  if (problems.length)
    throw new Error(
      `PerkKeep deployment configuration is unsafe: ${problems.join("; ")}.`,
    );
  if (missing.length)
    console.warn(
      `PerkKeep preview without ${missing.join(", ")}: it will show the setup screen.`,
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
