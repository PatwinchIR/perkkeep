import { timingSafeEqual } from "node:crypto";
import { deny } from "@/server/access";
import { connectionsDue } from "@/server/db";
import { syncConnection } from "@/server/sources/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Daily sync (vercel.json). Vercel sends "Authorization: Bearer <CRON_SECRET>" with cron requests.
function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  return (
    !!secret &&
    secret.length >= 32 &&
    given.length === expected.length &&
    timingSafeEqual(Buffer.from(given), Buffer.from(expected))
  );
}

export async function GET(request: Request) {
  if (!authorized(request)) return deny(401, "unauthorized", "Unauthorized.");
  const results: { status: string }[] = [];
  for (const { owner_id, connection_id } of await connectionsDue()) {
    try {
      results.push(await syncConnection(owner_id, connection_id, "scheduled"));
    } catch {
      results.push({ status: "failed" });
    }
  }
  // Counts only: no account names, amounts or errors leave in the cron response.
  return Response.json(
    {
      connections: results.length,
      failed: results.filter((r) => r.status === "failed").length,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
