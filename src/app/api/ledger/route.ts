import { checkAccess, deny, originAllowed } from "@/server/access";
import { withOwner } from "@/server/db";
import {
  loadSnapshot,
  operations,
  runOperation,
  type Operation,
} from "@/server/ledger";
import { failure, json } from "@/server/respond";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const access = await checkAccess();
    if (!access.ok) return deny(access.status, access.code, access.message);
    return json(await withOwner(access.ownerId, loadSnapshot));
  } catch (e) {
    return failure(e);
  }
}

export async function POST(request: Request) {
  if (!originAllowed(request))
    return deny(403, "origin", "Request origin is not allowed.");
  try {
    const access = await checkAccess();
    if (!access.ok) return deny(access.status, access.code, access.message);
    const body = (await request.json().catch(() => null)) as {
      op?: string;
      input?: unknown;
    } | null;
    if (!body?.op || !Object.hasOwn(operations, body.op))
      return deny(400, "unknown_op", "Unknown operation.");
    const op = body.op as Operation;
    return json(
      await withOwner(access.ownerId, (tx) =>
        runOperation(tx, op, body.input ?? {}),
      ),
    );
  } catch (e) {
    return failure(e);
  }
}
