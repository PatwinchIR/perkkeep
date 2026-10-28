import faces from "../../data/card-faces.json";
import type { Card } from "./types";

type Point = { x: number; y: number };
export type Band = {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
};
export type Face = {
  key: string | null;
  placeholder: [string, string];
  text: string;
  name: Point;
  number: Point;
  // Some products print only the last four digits, without the masking dots.
  digitsOnly: boolean;
  art?: {
    page: string;
    image: string;
    bands: Band[];
    crop?: { left: number; top: number; width: number; height: number };
  };
};
type Entry = Partial<Omit<Face, "key" | "placeholder">> & {
  match?: string[];
  placeholder?: string[];
};
const products = faces.products as unknown as Record<string, Entry>;

// The unidentified record keeps the neutral face until the owner confirms its product name.
export function faceFor(
  card: Pick<Card, "catalog_key" | "product_name">,
): Face {
  const byProduct = Object.entries(products).find(([, f]) =>
    f.match?.some((m) => m.toLowerCase() === card.product_name?.toLowerCase()),
  );
  const key =
    card.catalog_key &&
    card.catalog_key !== "chase-unidentified" &&
    products[card.catalog_key]
      ? card.catalog_key
      : (byProduct?.[0] ??
        (card.catalog_key === "chase-unidentified" ? card.catalog_key : null));
  const entry = (key && products[key]) || {};
  return {
    key,
    placeholder: (entry.placeholder ?? faces.default.placeholder) as [
      string,
      string,
    ],
    text: entry.text ?? faces.default.text,
    name: entry.name ?? faces.default.name,
    number: entry.number ?? faces.default.number,
    digitsOnly: entry.digitsOnly === true,
    art: key === "chase-unidentified" ? undefined : entry.art,
  };
}

// Product names with a known face, for suggestions when the owner adds a card by hand.
export const KNOWN_PRODUCTS = Object.values(products)
  .map((p) => p.match?.[0])
  .filter((name): name is string => !!name);

const ISSUERS: [RegExp, string][] = [
  [/^american express/i, "American Express"],
  [/^chase|prime visa/i, "Chase"],
  [/^discover/i, "Discover"],
  [/^citi/i, "Citi"],
  [/^apple card/i, "Apple"],
];
export function issuerFor(product: string): string | null {
  return ISSUERS.find(([pattern]) => pattern.test(product.trim()))?.[1] ?? null;
}
