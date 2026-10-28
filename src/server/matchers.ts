import "server-only";
import { randomUUID } from "node:crypto";
import type { Tx } from "./db";
import { ruleById, type BenefitRule } from "@/lib/catalog";
import { localDate, shiftDays } from "@/lib/domain";

// Deterministic matching (brief section 8). Only accounts the owner linked to a card are used,
// and only benefits created from a reviewed rule file. While a rule's patterns are unverified,
// every match is a candidate for the owner's review; a verified credit pattern yields confirmed
// issuer credit evidence. All writes go through apply_reconciliation in one transaction.
export const MATCHER_VERSION = "deterministic-1";
type Lookup = (id: string | null | undefined) => BenefitRule | undefined;

type Txn = {
  id: string;
  account_id: string;
  dedup_ref: string;
  transacted_on: string;
  posted_on: string | null;
  amount_cents: number;
  description: string;
};
type Coverage = {
  card_id: string;
  earliest_synced_on: string | null;
  synced_through: string | null;
  last_error: string | null;
};

const matches = (text: string, patterns: string[]) => {
  const t = text.toLowerCase();
  return patterns.find((p) => p && t.includes(p.toLowerCase()));
};

// A period is complete only when one linked account's successful sync covers all of it up to
// today; otherwise partial or unavailable. "No evidence" is never turned into "unused".
export function periodCoverage(
  period: { period_start: string; period_end_exclusive: string },
  accounts: Coverage[],
  today: string,
) {
  const lastDay = shiftDays(period.period_end_exclusive, -1);
  const needed = lastDay < today ? lastDay : today;
  let best: { coverage_status: string; coverage_through: string | null } = {
    coverage_status: "unavailable",
    coverage_through: null,
  };
  for (const a of accounts) {
    if (a.last_error || !a.earliest_synced_on || !a.synced_through) continue;
    const through = a.synced_through < needed ? a.synced_through : needed;
    if (
      a.earliest_synced_on <= period.period_start &&
      a.synced_through >= needed
    )
      return { coverage_status: "complete", coverage_through: needed };
    if (
      a.synced_through >= period.period_start &&
      a.earliest_synced_on <= needed
    )
      best = { coverage_status: "partial", coverage_through: through };
  }
  return best;
}

export async function runMatchers(
  tx: Tx,
  trigger: "manual" | "scheduled" = "manual",
  lookup: Lookup = ruleById,
  now = new Date(),
) {
  const { rows: linked } = await tx.query<Coverage & { account_id: string }>(
    `select a.id as account_id, a.card_id, c.earliest_synced_on, c.synced_through, c.last_error
     from public.accounts a left join public.account_coverage c on c.account_id=a.id
     where a.mapping_status='confirmed'`,
  );
  if (!linked.length)
    return {
      status: "nothing_linked",
      candidates: 0,
      confirmed: 0,
      conflicts: [] as string[],
    };
  const cardIds = [...new Set(linked.map((a) => a.card_id))];
  const { rows: benefits } = await tx.query(
    `select b.*, c.issuer_timezone from public.benefits b join public.cards c on c.id=b.card_id
     where b.enabled and c.status='active' and c.identity_verified_at is not null and b.card_id = any($1)`,
    [cardIds],
  );
  const { rows: txns } = await tx.query<Txn>(
    `select t.id, t.account_id, t.dedup_ref, t.transacted_on, t.posted_on, t.amount_cents, t.description
     from public.transactions t
     where t.account_id = any($1) and not t.pending and t.observation<>'removed'
       and not exists(select 1 from public.transactions l where l.supersedes_transaction_id=t.id)
     order by t.transacted_on, t.id`,
    [linked.map((a) => a.account_id)],
  );
  const evidence: Record<string, unknown>[] = [];
  const periods = new Map<
    string,
    {
      period_start: string;
      period_end_exclusive: string;
      card_id: string;
      verified: boolean;
    }
  >();
  const superseded = new Set<string>();
  const conflicts: string[] = [];
  const used = new Set<string>();
  const ensure = async (benefitId: string, day: string) => {
    await tx.query("savepoint matcher_period");
    try {
      const { rows } = await tx.query(
        "select * from public.ensure_period($1,$2)",
        [benefitId, day],
      );
      await tx.query("release savepoint matcher_period");
      return rows[0] as {
        id: string;
        period_start: string;
        period_end_exclusive: string;
        card_id: string;
      };
    } catch {
      await tx.query("rollback to savepoint matcher_period");
      return null;
    }
  };
  for (const b of benefits) {
    const rule = lookup(b.eligibility_rules_json?.catalog_rule_id);
    // Statements can only show use of benefits paid as statement credits. Others (Uber Cash,
    // in-app promos, hand-entered rules) never get coverage from transactions.
    if (!rule || rule.manual || !rule.matching.credit_patterns.length) continue;
    const today = localDate(now, b.issuer_timezone);
    const current = await ensure(b.id, today);
    if (current)
      periods.set(current.id, {
        ...current,
        verified: rule.matching.patterns_verified,
      });
    const accountIds = new Set(
      linked.filter((a) => a.card_id === b.card_id).map((a) => a.account_id),
    );
    const purchases = new Map<string, string[]>(); // period id → candidate purchase evidence ids
    const ordered = txns
      .filter((t) => accountIds.has(t.account_id))
      .sort((x, y) => Number(x.amount_cents > 0) - Number(y.amount_cents > 0)); // purchases first
    for (const t of ordered) {
      if (used.has(t.id)) continue;
      const credit = t.amount_cents > 0;
      const pattern = matches(
        t.description,
        credit
          ? rule.matching.credit_patterns
          : rule.matching.purchase_patterns,
      );
      if (!pattern) continue;
      const period = await ensure(b.id, t.transacted_on);
      if (!period) continue;
      periods.set(period.id, {
        ...period,
        verified: rule.matching.patterns_verified,
      });
      const sourceType = credit ? "statement_credit" : "purchase";
      const amount = Math.abs(Number(t.amount_cents));
      const { rows: prior } = await tx.query(
        `select amount_cents from public.redemption_evidence
         where benefit_period_id=$1 and source_type=$2 and source_reference_hash=$3`,
        [period.id, sourceType, t.dedup_ref],
      );
      if (prior[0]) {
        if (Number(prior[0].amount_cents) !== amount)
          conflicts.push(
            `${b.name}: a matched transaction on ${t.transacted_on} changed amount; review it manually.`,
          );
        used.add(t.id);
        continue;
      }
      const confirmed = credit && rule.matching.patterns_verified;
      const id = randomUUID();
      // A credit replaces one open candidate purchase in the same period, from this run or an
      // earlier one, so the purchase and its credit are never counted together.
      let supersedes = credit ? purchases.get(period.id)?.shift() : undefined;
      if (credit && !supersedes) {
        const { rows: open } = await tx.query(
          `select e.id from public.redemption_evidence e
           where e.benefit_period_id=$1 and e.source_type='purchase' and e.confidence='candidate' and e.recorded_by='import'
             and not exists(select 1 from public.redemption_evidence l where l.supersedes_evidence_id=e.id)
           order by e.transaction_date, e.id`,
          [period.id],
        );
        supersedes = open
          .map((r) => r.id as string)
          .find((id) => !superseded.has(id));
      }
      if (supersedes) superseded.add(supersedes);
      if (!credit)
        purchases.set(period.id, [...(purchases.get(period.id) ?? []), id]);
      evidence.push({
        id,
        benefit_period_id: period.id,
        source_type: sourceType,
        source_reference_hash: t.dedup_ref,
        transaction_date: t.transacted_on,
        merchant: t.description.slice(0, 200),
        amount_cents: amount,
        confidence: confirmed ? "confirmed" : "candidate",
        eligibility_result: confirmed ? "eligible" : "unknown",
        confirmation_result: confirmed
          ? "Issuer statement credit matched by verified pattern"
          : "Not confirmed",
        recorded_by: "import",
        notes: `Matched by ${MATCHER_VERSION} using rule ${rule.id} (version ${rule.version}) on "${pattern}"${
          rule.matching.patterns_verified
            ? ""
            : "; this pattern is not yet verified against your statements"
        }.`,
        ...(supersedes ? { supersedes_evidence_id: supersedes } : {}),
      });
      used.add(t.id);
    }
  }
  const coverage = [...periods.entries()].map(([id, p]) => {
    const tz = benefits.find((b) => b.card_id === p.card_id)?.issuer_timezone;
    const observed = periodCoverage(
      p,
      linked.filter((a) => a.card_id === p.card_id),
      localDate(now, tz),
    );
    // Until a credit pattern is verified, a credit posted under another description would be
    // missed, so coverage stays partial and the balance is never shown as known available.
    return {
      id,
      ...(observed.coverage_status === "complete" && !p.verified
        ? { ...observed, coverage_status: "partial" }
        : observed),
    };
  });
  if (!evidence.length && !coverage.length)
    return {
      status: "nothing_to_match",
      candidates: 0,
      confirmed: 0,
      conflicts,
    };
  const { rows } = await tx.query(
    "select * from public.apply_reconciliation($1,$2,$3,$4,$5)",
    [
      randomUUID(),
      trigger,
      JSON.stringify(coverage),
      JSON.stringify(evidence),
      JSON.stringify({
        source: "matcher",
        version: MATCHER_VERSION,
        conflicts,
      }),
    ],
  );
  const run = rows[0];
  return {
    status: run.status as string,
    error: run.error_summary as string | null,
    candidates: run.candidates_found as number,
    confirmed: run.confirmed_updates as number,
    conflicts,
  };
}

// Matching after a sync or import must never undo the sync itself.
export async function runMatchersSafely(
  tx: Tx,
  trigger: "manual" | "scheduled",
) {
  await tx.query("savepoint matchers");
  try {
    const result = await runMatchers(tx, trigger);
    await tx.query("release savepoint matchers");
    return result;
  } catch (e) {
    await tx.query("rollback to savepoint matchers");
    console.error(
      "PerkKeep matcher failed",
      e instanceof Error ? e.name : "unknown",
    );
    return {
      status: "matcher_failed",
      candidates: 0,
      confirmed: 0,
      conflicts: [] as string[],
    };
  }
}
