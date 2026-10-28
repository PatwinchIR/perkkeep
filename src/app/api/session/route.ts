import { checkAccess } from "@/server/access";
import { authProvider, currentIdentity } from "@/server/identity";
import { failure, json } from "@/server/respond";

export const dynamic = "force-dynamic";

// Tells the PWA which screen to show. It never returns ledger data.
export async function GET() {
  try {
    const provider = authProvider();
    if (!provider) return json({ state: "unconfigured" });
    const identity = await currentIdentity();
    const access = await checkAccess(identity);
    return json({
      state: access.ok ? "owner" : access.code,
      provider,
      email: identity?.email ?? null,
      name: identity?.name ?? null,
      message: access.ok ? null : access.message,
    });
  } catch (e) {
    return failure(e);
  }
}
