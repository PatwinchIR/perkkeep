import "server-only";
import { currentIdentity, type Identity } from "./identity";
import { resolveOwner } from "./db";

export type Access =
  | { ok: true; ownerId: string; identity: Identity }
  | { ok: false; status: 401 | 403; code: string; message: string };

export function ownerEmails(): string[] {
  return (process.env.PERKKEEP_OWNER_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

// Private owner access: a verified session for an allowlisted, verified email address.
// An empty allowlist admits nobody.
export async function checkAccess(identity?: Identity | null): Promise<Access> {
  const who = identity === undefined ? await currentIdentity() : identity;
  if (!who)
    return {
      ok: false,
      status: 401,
      code: "signed_out",
      message: "Sign in to continue.",
    };
  if (who.expiresAt.getTime() <= Date.now())
    return {
      ok: false,
      status: 401,
      code: "expired",
      message: "Your session expired. Sign in again.",
    };
  if (!who.emailVerified)
    return {
      ok: false,
      status: 403,
      code: "email_unverified",
      message: "Verify your email address before opening the ledger.",
    };
  if (!ownerEmails().includes(who.email.toLowerCase()))
    return {
      ok: false,
      status: 403,
      code: "not_owner",
      message: "This PerkKeep workspace is private to its owner.",
    };
  const ownerId = await resolveOwner(who.provider, who.subject, who.email);
  return { ok: true, ownerId, identity: who };
}

export function allowedOrigins(): string[] {
  const list = (process.env.PERKKEEP_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim().replace(/\/$/, ""))
    .filter(Boolean);
  for (const host of [
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_BRANCH_URL,
    process.env.VERCEL_URL,
  ])
    if (host) list.push(`https://${host}`);
  if (!process.env.VERCEL)
    list.push("http://127.0.0.1:3017", "http://localhost:3017");
  return list;
}

// Cross-site requests must not reach state-changing handlers, whatever cookies they carry.
export function originAllowed(request: Request): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;
  const origin = request.headers.get("origin");
  if (!origin || !allowedOrigins().includes(origin)) return false;
  const site = request.headers.get("sec-fetch-site");
  return !site || site === "same-origin";
}

export function deny(status: number, code: string, message: string) {
  return Response.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
