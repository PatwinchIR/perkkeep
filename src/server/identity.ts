import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { createNeonAuth } from "@neondatabase/auth/next/server";

export type Identity = {
  provider: "neon" | "test";
  subject: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
  expiresAt: Date;
};

export const TEST_COOKIE = "perkkeep_test_session";
type NeonAuth = ReturnType<typeof createNeonAuth>;
let neon: NeonAuth | null = null;

export function authProvider(): "neon" | "test" | null {
  const p = process.env.PERKKEEP_AUTH_PROVIDER ?? "neon";
  if (p === "test") return testAuthAllowed() ? "test" : null;
  if (p === "neon")
    return process.env.NEON_AUTH_BASE_URL && process.env.NEON_AUTH_COOKIE_SECRET
      ? "neon"
      : null;
  return null;
}

// The synthetic test provider exists only for local tests: never on Vercel, never against a
// non-local database, and only with a local secret.
export function testAuthAllowed(): boolean {
  if (process.env.VERCEL || process.env.PERKKEEP_AUTH_PROVIDER !== "test")
    return false;
  const secret = process.env.PERKKEEP_TEST_AUTH_SECRET;
  if (!secret || secret.length < 32) return false;
  try {
    return ["localhost", "127.0.0.1", "::1"].includes(
      new URL(process.env.PERKKEEP_DATABASE_URL ?? "").hostname,
    );
  } catch {
    return false;
  }
}

export function neonAuth(): NeonAuth {
  neon ??= createNeonAuth({
    baseUrl: process.env.NEON_AUTH_BASE_URL!,
    cookies: {
      secret: process.env.NEON_AUTH_COOKIE_SECRET!,
      sessionDataTtl: 60,
    },
    logLevel: "warn",
  });
  return neon;
}

const sign = (payload: string) =>
  createHmac("sha256", process.env.PERKKEEP_TEST_AUTH_SECRET!)
    .update(payload)
    .digest("base64url");

export function signTestSession(
  identity: Omit<Identity, "provider" | "expiresAt">,
  ttlSeconds = 3600,
) {
  const payload = Buffer.from(
    JSON.stringify({ ...identity, exp: Date.now() + ttlSeconds * 1000 }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function readTestSession(value: string | undefined): Identity | null {
  if (!value) return null;
  const [payload, mac] = value.split(".");
  if (!payload || !mac) return null;
  const expected = Buffer.from(sign(payload)),
    actual = Buffer.from(mac);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
    return null;
  const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  return {
    provider: "test",
    subject: String(data.subject),
    email: String(data.email),
    name: data.name ? String(data.name) : null,
    emailVerified: data.emailVerified === true,
    expiresAt: new Date(Number(data.exp)),
  };
}

// Verifies the session on the server. Browser-supplied identity is never trusted.
export async function currentIdentity(): Promise<Identity | null> {
  const provider = authProvider();
  if (provider === "test")
    return readTestSession((await cookies()).get(TEST_COOKIE)?.value);
  if (provider !== "neon") return null;
  const { data } = await neonAuth().getSession();
  if (!data?.session || !data.user) return null;
  return {
    provider: "neon",
    subject: String(data.user.id),
    email: String(data.user.email),
    name: data.user.name ? String(data.user.name) : null,
    emailVerified: data.user.emailVerified === true,
    expiresAt: new Date(data.session.expiresAt),
  };
}
