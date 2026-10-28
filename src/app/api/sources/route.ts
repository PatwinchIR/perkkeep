import { checkAccess, deny, originAllowed } from "@/server/access";
import { failure, json } from "@/server/respond";
import {
  runSourceOperation,
  sourceOperations,
  type SourceOperation,
} from "@/server/sources/operations";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
    if (!body?.op || !Object.hasOwn(sourceOperations, body.op))
      return deny(400, "unknown_op", "Unknown operation.");
    return json(
      await runSourceOperation(
        access.ownerId,
        body.op as SourceOperation,
        body.input ?? {},
      ),
    );
  } catch (e) {
    return failure(e);
  }
}
