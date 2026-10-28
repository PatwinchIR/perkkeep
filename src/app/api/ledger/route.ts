import { assertSameOrigin, requireOwner } from "@/lib/server/auth";
import { LedgerError, publicError, withOwner } from "@/lib/server/db";
import { loadSnapshot, runOperation } from "@/lib/server/ledger";

export const dynamic = "force-dynamic";
const PRIVATE = { "Cache-Control": "private, no-store, max-age=0" };
const MAX_BODY = 512 * 1024;

function failure(error: unknown) {
  const { message, status } = publicError(error);
  if (status >= 500) console.error("ledger request failed", error);
  return Response.json({ error: message }, { status, headers: PRIVATE });
}

export async function GET() {
  try {
    const owner = await requireOwner();
    const snapshot = await withOwner(owner, loadSnapshot);
    return Response.json({ data: snapshot }, { headers: PRIVATE });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      throw new LedgerError("Send JSON.", 415);
    const raw = await request.text();
    if (raw.length > MAX_BODY)
      throw new LedgerError("Request is too large.", 413);
    let body: { op?: unknown; input?: unknown };
    try {
      body = JSON.parse(raw);
    } catch {
      throw new LedgerError("Malformed JSON.");
    }
    const owner = await requireOwner();
    const data = await withOwner(owner, (c) =>
      runOperation(c, body.op, body.input),
    );
    return Response.json({ data }, { headers: PRIVATE });
  } catch (error) {
    return failure(error);
  }
}
