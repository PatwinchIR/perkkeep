import amexGold from "../../data/benefits/amex-gold.json";
import sapphireReserve from "../../data/benefits/chase-sapphire-reserve.json";
import freedomFlex from "../../data/benefits/chase-freedom-flex.json";
import freedomUnlimited from "../../data/benefits/chase-freedom-unlimited.json";
import primeVisa from "../../data/benefits/chase-prime-visa.json";
import discoverIt from "../../data/benefits/discover-it.json";
import inkCash from "../../data/benefits/chase-ink-business-cash.json";
import inkPreferred from "../../data/benefits/chase-ink-business-preferred.json";

// The knowledge layer: reviewable rule files in data/benefits (see its README). Rules are drafting
// aids and matching hints, never automatically seeded or enabled as entitlements.
export type RuleFile = {
  product: string;
  catalog_key: string;
  issuer: string;
  researched: boolean;
  rules: BenefitRule[];
};
export type BenefitRule = {
  id: string;
  version: string;
  name: string;
  period: string;
  amount_cents?: number | null;
  units?: number | null;
  unit_label?: string | null;
  enrollment_required: boolean;
  eligibility_notes: string;
  source_url: string;
  checked_on: string;
  effective_from: string | null;
  effective_to: string | null;
  verified: boolean;
  manual: boolean;
  matching: {
    credit_patterns: string[];
    purchase_patterns: string[];
    patterns_verified: boolean;
    // The date and the exact statement wording that verified the patterns.
    patterns_verified_on?: string;
    observed_descriptor?: string;
  };
};
export const RULE_FILES = [
  amexGold,
  sapphireReserve,
  freedomFlex,
  freedomUnlimited,
  primeVisa,
  discoverIt,
  inkCash,
  inkPreferred,
] as RuleFile[];

export const ruleById = (id: string | null | undefined) =>
  id ? RULE_FILES.flatMap((f) => f.rules).find((r) => r.id === id) : undefined;

// Shape used by the benefit form's template picker.
export type CatalogRule = {
  id: string;
  product: string;
  name: string;
  cadence: string;
  cents: number | null;
  description: string;
  enrollment: boolean;
  manual: boolean;
  source: string;
  checkedAt: string;
  verified: boolean;
  effectiveFrom: string | null;
  effectiveTo: string | null;
};
export const CATALOG: CatalogRule[] = RULE_FILES.flatMap((f) =>
  f.rules.map((r) => ({
    id: r.id,
    product: f.product,
    name: r.name,
    cadence: r.period,
    cents: r.amount_cents ?? null,
    description: r.eligibility_notes,
    enrollment: r.enrollment_required,
    manual: r.manual,
    source: r.source_url,
    checkedAt: r.checked_on,
    verified: r.verified,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
  })),
);
