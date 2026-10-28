import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
export const env = JSON.parse(
  readFileSync(".local/supabase.json", "utf8"),
) as Record<string, string>;
if (!["localhost", "127.0.0.1"].includes(new URL(env.API_URL).hostname))
  throw new Error("Tests refuse non-local databases");
export const admin = createClient(env.API_URL, env.SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
export const freshClient = () =>
  createClient(env.API_URL, env.PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
export function ok<T>(result: { data: T; error: unknown }): NonNullable<T> {
  if (result.error) throw result.error;
  if (result.data == null) throw new Error("Missing result");
  return result.data;
}
export async function user() {
  const email = `test-${randomUUID()}@perkkeep.test`,
    password = `Pk-${randomUUID()}!`;
  const createdResult = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createdResult.error || !createdResult.data.user)
    throw createdResult.error ?? new Error("No user");
  const created = createdResult.data.user;
  const client = freshClient();
  const signed = await client.auth.signInWithPassword({ email, password });
  if (signed.error) throw signed.error;
  return { id: created.id, email, password, client };
}
export async function fixture(
  client: SupabaseClient,
  cadence = "monthly",
  extra: Record<string, unknown> = {},
  onDate = "2026-10-15",
) {
  const card = ok(
    await client
      .from("cards")
      .insert({
        issuer: "Synthetic Test Issuer",
        display_name: "Synthetic test card",
        last4: String(Math.floor(Math.random() * 9000) + 1000),
        status: "active",
        identity_verified_at: new Date().toISOString(),
        cardmember_anchor_date: "2020-03-15",
      })
      .select()
      .single(),
  );
  const benefit = ok(
    await client
      .from("benefits")
      .insert({
        card_id: card.id,
        name: "Synthetic test allowance — not an entitlement",
        cadence,
        nominal_amount_cents: 1000,
        effective_from: "2020-01-01",
        issuer_source_url: "https://example.com/synthetic-test-only",
        verified_at: new Date().toISOString(),
        enabled: true,
        eligibility_status: "eligible",
        enrollment_status: "not_required",
        ...extra,
      })
      .select()
      .single(),
  );
  const period = ok(
    await client.rpc("ensure_period", {
      p_benefit_id: benefit.id,
      p_on: onDate,
    }),
  );
  return { card, benefit, period };
}
