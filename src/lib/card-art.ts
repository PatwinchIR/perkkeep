// Official product images published by each issuer, matched by the card's
// confirmed product name. Only links are kept here; images are fetched from the
// issuer through Next.js image optimization and are never committed to this repo.
// An issuer image shows the product, not the owner's own card or its identity.
// Checked October 28, 2026 on the issuers' public product pages.

export type CardDesign = {
  id: string;
  label: string;
  src: string;
  width: number;
  height: number;
  /** Region of `src` showing this design, when one image holds several. */
  crop?: { x: number; y: number; w: number; h: number };
};

const chase = (file: string) =>
  `https://creditcards.chase.com/content/dam/jpmc-marketplace/card-art/${file}`;
const discoverGallery =
  "https://ecm.capitalone.com/WCM/dfs-card/images/card-art-array/rdesktop.png";
const discover = (
  id: string,
  label: string,
  col: number,
  row: number,
): CardDesign => ({
  id,
  label,
  src: discoverGallery,
  width: 1360,
  height: 578,
  crop: { x: [2, 472, 956][col], y: [2, 325][row], w: 400, h: 253 },
});

export const CARD_ART: Record<string, CardDesign[]> = {
  "american express gold": [
    {
      id: "gold",
      label: "Gold",
      src: "https://icm.aexp-static.com/Internet/Acquisition/US_en/AppContent/OneSite/category/cardarts/gold-card.png",
      width: 314,
      height: 199,
    },
  ],
  "chase sapphire reserve": [
    {
      id: "standard",
      label: "Standard",
      src: chase("sapphire_reserve_card_Halo.png"),
      width: 289,
      height: 181,
    },
  ],
  "chase freedom flex": [
    {
      id: "standard",
      label: "Standard",
      src: chase("freedom_flex_card.png"),
      width: 289,
      height: 181,
    },
  ],
  "chase freedom unlimited": [
    {
      id: "standard",
      label: "Standard",
      src: chase("freedom_unlimited_card_alt.png"),
      width: 289,
      height: 181,
    },
  ],
  "chase prime visa": [
    {
      id: "prime",
      label: "Prime Visa",
      src: chase("prime-visa.png"),
      width: 490,
      height: 313,
    },
  ],
  "chase ink business cash": [
    {
      id: "standard",
      label: "Standard",
      src: chase("ink_cash_card.png"),
      width: 289,
      height: 181,
    },
  ],
  "chase ink business preferred": [
    {
      id: "standard",
      label: "Standard",
      src: chase("ink_preferred_card.png"),
      width: 289,
      height: 181,
    },
  ],
  "discover it": [
    discover("teal", "Teal", 0, 0),
    discover("cassette", "Cassette", 1, 0),
    discover("pink", "Pink", 2, 0),
    discover("city", "City skyline", 0, 1),
    discover("gold", "Gold", 1, 1),
    discover("burgundy", "Burgundy", 2, 1),
  ],
};

export const CARD_ART_HOSTS = [
  "creditcards.chase.com",
  "icm.aexp-static.com",
  "ecm.capitalone.com",
];

export function cardDesigns(productName: string | null): CardDesign[] {
  return productName ? (CARD_ART[productName.trim().toLowerCase()] ?? []) : [];
}

export function cardDesign(card: {
  product_name: string | null;
  art_design?: string | null;
}): CardDesign | null {
  const designs = cardDesigns(card.product_name);
  return designs.find((d) => d.id === card.art_design) ?? designs[0] ?? null;
}
