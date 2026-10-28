import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import type { Snapshot, Period } from "./types";
import { localDate } from "./domain";
type QueryResult<T> = { data: T[] | null; error: { message: string } | null };
async function all<T>(
  query: (start: number, end: number) => PromiseLike<QueryResult<T>>,
): Promise<T[]> {
  const result: T[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await query(from, from + 499);
    if (error) throw new Error(error.message);
    result.push(...(data ?? []));
    if (!data || data.length < 500) return result;
  }
}
export async function loadSnapshot(
  db: SupabaseClient<Database>,
): Promise<Snapshot> {
  const [cards, benefits] = await Promise.all([
    all((a, b) =>
      db.from("cards").select("*").order("created_at").order("id").range(a, b),
    ),
    all((a, b) =>
      db
        .from("benefits")
        .select("*")
        .order("created_at")
        .order("id")
        .range(a, b),
    ),
  ]);
  cards.sort((a, b) => a.display_name.localeCompare(b.display_name));
  const periodErrors: string[] = [];
  const eligibleBenefits = benefits.filter((b) => {
    const card = cards.find((c) => c.id === b.card_id),
      day = localDate(new Date(), card?.issuer_timezone);
    return (
      b.enabled &&
      card?.status === "active" &&
      b.effective_from <= day &&
      (!b.effective_to || b.effective_to > day)
    );
  });
  const generated = await Promise.allSettled(
    eligibleBenefits.map(async (b) => {
      const { error } = await db.rpc("ensure_period", { p_benefit_id: b.id });
      if (error) throw new Error(`${b.name}: ${error.message}`);
    }),
  );
  for (const r of generated)
    if (r.status === "rejected") periodErrors.push(String(r.reason.message));
  const [periods, evidence, runs, audit] = await Promise.all([
    all((a, b) =>
      db
        .from("period_balances")
        .select("*")
        .order("period_start", { ascending: false })
        .order("id")
        .range(a, b),
    ),
    all((a, b) =>
      db
        .from("redemption_evidence")
        .select("*")
        .order("recorded_at", { ascending: false })
        .order("id")
        .range(a, b),
    ),
    all((a, b) =>
      db
        .from("sync_runs")
        .select("*")
        .order("started_at", { ascending: false })
        .order("id")
        .range(a, b),
    ),
    all((a, b) =>
      db
        .from("audit_events")
        .select("*")
        .order("occurred_at", { ascending: false })
        .order("id")
        .range(a, b),
    ),
  ]);
  return {
    cards,
    benefits,
    periods: periods as Period[],
    evidence,
    runs,
    audit,
    periodErrors,
  };
}
