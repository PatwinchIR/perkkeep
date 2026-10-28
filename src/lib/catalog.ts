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
};
const amex =
  "https://www.americanexpress.com/en-us/account/get-started/gold/explore-benefits";
// These are sourced drafting aids, NEVER automatically seeded or enabled as entitlements.
// checkedAt is a source observation date, NOT the issuer's effective date.
export const CATALOG: CatalogRule[] = [
  {
    id: "gold-dining",
    product: "American Express Gold",
    name: "Dining credit",
    cadence: "monthly",
    cents: 1000,
    description:
      "Up to $10 monthly at participating partners. Current partners include Grubhub/Seamless, Buffalo Wild Wings, Five Guys, The Cheesecake Factory and Wonder. Enrollment required; verify all exclusions with Amex.",
    enrollment: true,
    manual: false,
    source: amex,
    checkedAt: "2026-10-27",
  },
  {
    id: "gold-resy",
    product: "American Express Gold",
    name: "Resy credit",
    cadence: "semiannual",
    cents: 5000,
    description:
      "Up to $50 January–June and $50 July–December on eligible purchases at qualifying U.S. Resy restaurants. Enrollment required.",
    enrollment: true,
    manual: false,
    source: amex,
    checkedAt: "2026-10-27",
  },
  {
    id: "gold-dunkin",
    product: "American Express Gold",
    name: "Dunkin’ credit",
    cadence: "monthly",
    cents: 700,
    description:
      "Up to $7 monthly for eligible purchases at U.S. Dunkin’ locations. Enrollment required.",
    enrollment: true,
    manual: false,
    source: amex,
    checkedAt: "2026-10-27",
  },
  {
    id: "gold-uber",
    product: "American Express Gold",
    name: "Uber Cash",
    cadence: "monthly",
    cents: 1000,
    description:
      "$10 monthly in U.S. Uber Cash after adding the Gold Card to Uber. Select an Amex payment method and turn Uber Cash on. Confirm actual use in Uber; a card purchase alone does not establish redemption.",
    enrollment: true,
    manual: true,
    source: amex,
    checkedAt: "2026-10-27",
  },
  {
    id: "reserve-travel",
    product: "Chase Sapphire Reserve",
    name: "Annual travel credit",
    cadence: "custom",
    cents: 30000,
    description:
      "Up to $300 for eligible travel purchases. The agreement defines annual windows by statement dates/billing cycles. Enter the actual start and end shown in your Chase account; do not infer them from a calendar anniversary.",
    enrollment: false,
    manual: false,
    source:
      "https://static.chasecdn.com/content/dam/card/rulesregulations/en/RPA0550_Web.pdf",
    checkedAt: "2026-10-27",
  },
];
