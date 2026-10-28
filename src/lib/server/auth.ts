import "server-only";
import { hkdfSync } from "node:crypto";
import { cookies } from "next/headers";
import { createNeonAuth } from "@neondatabase/auth/next/server";
import { LedgerError, type Owner } from "./db";

export function neonAuthBaseUrl() {
  return (
    process.env.NEON_AUTH_BASE_URL ??
    process.env.NEON_AUTH_URL ??
    process.env.NEXT_PUBLIC_NEON_AUTH_URL ??
    ""
  );
}

// Signs the short-lived session-data cookie. An explicit secret is preferred. Without
// one, a key is derived from the server-only database credential, which never
// reaches the browser; rotating that credential signs everyone out.
function cookieSecret() {
  const explicit = process.env.NEON_AUTH_COOKIE_SECRET;
  if (explicit && explicit.length >= 32) return explicit;
  const material = process.env.DATABASE_URL;
  if (!material) throw new LedgerError("Sign-in is not configured.", 503);
  return Buffer.from(
    hkdfSync("sha256", material, "perkkeep", "neon-auth-cookie-v1", 32),
  ).toString("base64url");
}

let instance: ReturnType<typeof createNeonAuth> | null = null;
export function neonAuth() {
  const baseUrl = neonAuthBaseUrl();
  if (!baseUrl) throw new LedgerError("Sign-in is not configured.", 503);
  instance ??= createNeonAuth({
    baseUrl,
    cookies: { secret: cookieSecret(), sessionDataTtl: 60, sameSite: "lax" },
    logLevel: "warn",
  });
  return instance;
}

/**
 * Private owner access: only listed addresses may sign up or read a ledger.
 * `name+tag@domain` aliases of a listed address are accepted only when explicitly
 * enabled, so the owner can create separate, isolated verification accounts that
 * still deliver to their own mailbox. Each alias is its own ledger owner.
 */
export function isAllowedEmail(email: string) {
  const allowed = (process.env.PERKKEEP_OWNER_EMAILS ?? "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  const normalized = email.trim().toLowerCase();
  if (allowed.includes(normalized)) return true;
  if (process.env.PERKKEEP_OWNER_PLUS_ALIASES !== "allow") return false;
  const match = /^([^+@]+)\+[a-z0-9._-]{1,40}@([^@]+)$/.exec(normalized);
  return !!match && allowed.includes(`${match[1]}@${match[2]}`);
}

export type SessionState =
  | { state: "signed_out" }
  | { state: "unverified"; email: string }
  | { state: "not_allowed"; email: string }
  | { state: "owner"; email: string; owner: Owner };

/**
 * Asks Neon Auth to validate the session token on every call (the signed cookie
 * cache is bypassed), so sign-out, revocation and expiry take effect immediately.
 */
export async function currentSession(): Promise<SessionState> {
  // Without a session token there is nothing to verify; skip the network call.
  const jar = await cookies();
  if (!jar.getAll().some((c) => c.name.endsWith("neon-auth.session_token")))
    return { state: "signed_out" };
  const { data, error } = await neonAuth().getSession({
    query: { disableCookieCache: "true" },
  });
  if (error) {
    if (error.status && error.status < 500) return { state: "signed_out" };
    throw new LedgerError("Sign-in service is unavailable.", 503);
  }
  const user = data?.user,
    session = data?.session;
  if (!user?.id || !user.email || !session) return { state: "signed_out" };
  if (new Date(session.expiresAt).getTime() <= Date.now())
    return { state: "signed_out" };
  if (!user.emailVerified) return { state: "unverified", email: user.email };
  if (!isAllowedEmail(user.email))
    return { state: "not_allowed", email: user.email };
  return {
    state: "owner",
    email: user.email,
    owner: { neonAuthUserId: String(user.id), email: user.email },
  };
}

export async function requireOwner(): Promise<Owner> {
  const session = await currentSession();
  if (session.state === "owner") return session.owner;
  if (session.state === "signed_out")
    throw new LedgerError("Sign in to continue.", 401);
  if (session.state === "unverified")
    throw new LedgerError("Verify your email address to continue.", 403);
  throw new LedgerError(
    "This account does not have access to this ledger.",
    403,
  );
}

/** Rejects cross-site browser writes even though cookies are SameSite=Lax. */
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host || new URL(origin).host !== host)
    throw new LedgerError("Cross-origin request rejected.", 403);
}
