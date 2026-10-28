import type { NextConfig } from "next";
// All ledger and auth credentials stay on the server. The browser talks only to
// same-origin /api routes.
const env = process.env;
const neonAuthUrl =
  env.NEON_AUTH_BASE_URL ?? env.NEON_AUTH_URL ?? env.NEXT_PUBLIC_NEON_AUTH_URL;
// No browser-visible variable may carry a database URL or secret.
for (const [name, value] of Object.entries(env))
  if (
    name.startsWith("NEXT_PUBLIC_") &&
    /postgres(ql)?:\/\/|secret/i.test(value ?? "")
  )
    throw new Error(`${name} must not contain a database URL or secret.`);
// Production builds must have the database, Neon Auth and private owner access.
if (env.VERCEL_ENV === "production") {
  if (!env.DATABASE_URL || !neonAuthUrl)
    throw new Error(
      "Attach the Neon database and Neon Auth: DATABASE_URL and NEON_AUTH_BASE_URL are required.",
    );
  if (new URL(neonAuthUrl).protocol !== "https:")
    throw new Error("Neon Auth must use HTTPS.");
  if (!env.PERKKEEP_OWNER_EMAILS?.trim())
    throw new Error(
      "Set PERKKEEP_OWNER_EMAILS so only the owner can sign up and read the ledger.",
    );
}
const config: NextConfig = {
  poweredByHeader: false,
  // Official issuer card art only (see src/lib/card-art.ts). Images are fetched by
  // the server-side optimizer, so browsers never contact the issuers directly.
  images: {
    remotePatterns: [
      new URL(
        "https://creditcards.chase.com/content/dam/jpmc-marketplace/card-art/**",
      ),
      new URL(
        "https://icm.aexp-static.com/Internet/Acquisition/US_en/AppContent/OneSite/category/cardarts/**",
      ),
      new URL("https://ecm.capitalone.com/WCM/dfs-card/images/**"),
    ],
  },
  devIndicators: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          // "same-origin" keeps the Origin header on same-site writes, which the server checks.
          { key: "Referrer-Policy", value: "same-origin" },
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
