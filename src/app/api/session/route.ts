import { currentSession } from "@/lib/server/auth";
import { publicError } from "@/lib/server/db";

export const dynamic = "force-dynamic";
const PRIVATE = { "Cache-Control": "private, no-store, max-age=0" };

/** Reports sign-in state without exposing any internal identifier. */
export async function GET() {
  try {
    const session = await currentSession();
    return Response.json(
      session.state === "signed_out"
        ? { state: session.state }
        : { state: session.state, email: session.email },
      { headers: PRIVATE },
    );
  } catch (error) {
    const { message, status } = publicError(error);
    return Response.json({ error: message }, { status, headers: PRIVATE });
  }
}
