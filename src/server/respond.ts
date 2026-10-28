import "server-only";
import { InputError } from "./ledger";
import { deny } from "./access";

const NO_STORE = { "Cache-Control": "no-store" };
export const json = (data: unknown, status = 200) =>
  Response.json({ data }, { status, headers: NO_STORE });

// Database rule violations are explained to the owner; anything else stays a generic failure.
export function failure(e: unknown) {
  const pgCode = (e as { code?: string })?.code;
  if (
    e instanceof InputError ||
    pgCode === "P0001" ||
    pgCode?.startsWith("22") ||
    pgCode?.startsWith("23")
  )
    return deny(
      400,
      "rejected",
      e instanceof Error ? e.message : "Request rejected.",
    );
  if (pgCode === "42P01" || pgCode === "42703" || pgCode === "42883")
    return deny(
      409,
      "migration_pending",
      "The database is behind this version of PerkKeep. Apply the pending migration (npm run neon:migrate), then try again.",
    );
  if (pgCode === "42501")
    return deny(
      403,
      "forbidden",
      "That record is not available to this owner.",
    );
  console.error(
    "PerkKeep request failed",
    pgCode ?? (e instanceof Error ? e.name : "unknown"),
  );
  return deny(500, "server_error", "Something went wrong. Nothing was saved.");
}
