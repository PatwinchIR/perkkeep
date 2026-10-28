import { isAllowedEmail, neonAuth } from "@/lib/server/auth";
import { publicError } from "@/lib/server/db";

export const dynamic = "force-dynamic";

// Only the flows Perkkeep uses are forwarded to Neon Auth. Social, magic-link,
// organization, admin and token endpoints are not reachable through this app.
const ALLOWED: Record<string, string[]> = {
  "get-session": ["GET"],
  "sign-in/email": ["POST"],
  "sign-up/email": ["POST"],
  "sign-out": ["POST"],
  "send-verification-email": ["POST"],
  "verify-email": ["GET"],
  "request-password-reset": ["POST"],
  "reset-password": ["POST"],
  "revoke-sessions": ["POST"],
};
type Context = { params: Promise<{ path: string[] }> };

async function handle(request: Request, context: Context) {
  const path = (await context.params).path.join("/");
  if (!ALLOWED[path]?.includes(request.method))
    return Response.json({ message: "Not found" }, { status: 404 });
  try {
    if (path === "sign-up/email") {
      const body = (await request
        .clone()
        .json()
        .catch(() => null)) as { email?: unknown } | null;
      if (typeof body?.email !== "string" || !isAllowedEmail(body.email))
        return Response.json(
          {
            message:
              "Perkkeep is private. This email address is not on the owner list.",
            code: "OWNER_ONLY",
          },
          { status: 403 },
        );
    }
    const handlers = neonAuth().handler();
    const response =
      request.method === "GET"
        ? await handlers.GET(request, context)
        : await handlers.POST(request, context);
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "private, no-store, max-age=0");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch (error) {
    const { message, status } = publicError(error);
    return Response.json({ message }, { status });
  }
}
export const GET = handle;
export const POST = handle;
