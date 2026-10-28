import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";
import { deny, originAllowed } from "@/server/access";
import {
  signTestSession,
  TEST_COOKIE,
  testAuthAllowed,
} from "@/server/identity";

export const dynamic = "force-dynamic";
const body = z.object({
  email: z.email(),
  name: z.string().max(100).nullable().optional(),
  emailVerified: z.boolean().default(true),
  subject: z.string().max(200).optional(),
  ttlSeconds: z.number().int().min(-3600).max(86400).default(3600),
});

// Local synthetic sign-in for tests and local development. It does not exist on Vercel or with a
// non-local database. Callers need the local secret or a same-origin request from the local app.
function permitted(request: Request) {
  const secret = request.headers.get("x-perkkeep-test-secret");
  if (secret) return secret === process.env.PERKKEEP_TEST_AUTH_SECRET;
  return !!request.headers.get("origin") && originAllowed(request);
}

export async function POST(request: Request) {
  if (!testAuthAllowed()) return deny(404, "not_found", "Not found.");
  if (!permitted(request))
    return deny(403, "forbidden", "Local test sign-in only.");
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return deny(400, "invalid", "Invalid test identity.");
  const { ttlSeconds, ...identity } = parsed.data;
  const value = signTestSession(
    {
      ...identity,
      name: identity.name ?? null,
      subject: identity.subject ?? `test-${randomUUID()}`,
    },
    ttlSeconds,
  );
  (await cookies()).set(TEST_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  return Response.json(
    { data: { cookie: value } },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function DELETE(request: Request) {
  if (!testAuthAllowed()) return deny(404, "not_found", "Not found.");
  if (!permitted(request))
    return deny(403, "forbidden", "Local test sign-in only.");
  (await cookies()).delete(TEST_COOKIE);
  return new Response(null, { status: 204 });
}
