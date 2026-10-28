import { deny, originAllowed } from "@/server/access";
import { authProvider, neonAuth } from "@/server/identity";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path: string[] }> };

// Proxies Neon Auth only when it is configured; state-changing calls must come from an allowed origin.
async function handle(request: Request, context: Context) {
  if (authProvider() !== "neon")
    return deny(404, "not_configured", "Neon Auth is not configured.");
  if (!originAllowed(request))
    return deny(403, "origin", "Request origin is not allowed.");
  const handler = neonAuth().handler();
  const method = request.method as "GET" | "POST";
  return handler[method](request, context);
}
export { handle as GET, handle as POST };
