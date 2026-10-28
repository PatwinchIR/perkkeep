import { decimalToCents } from "./types";

// CSV formats are detected from the exact header row. The issuer layouts below come from the
// architect's and agent's memory of common exports and are marked unverified until a real file of
// each kind has been imported. The Copilot Money layout was read from the owner's real export on
// 2026-10-28 (D53); it holds every account in one file, so each row names its account.
export type CsvAccount = { name: string; mask: string | null };
export type CsvRow = {
  transactedOn: string;
  postedOn: string | null;
  amountCents: number;
  description: string;
  // Set only by multi-account layouts.
  account?: CsvAccount;
};
export type Format = {
  id: string;
  label: string;
  verified: boolean;
  headers: string[];
  date: string;
  posted?: string;
  description: string;
  amount: string;
  // Multiply the file's amount by this to get PerkKeep's sign (negative = money out).
  sign: 1 | -1;
  // Multi-account exports: the columns naming each row's account, and which rows are statement
  // activity at all (the rest are dropped before anything is hashed or stored).
  account?: { name: string; mask: string };
  include?: (row: Record<string, string>) => boolean;
};
export const COPILOT_FORMAT_ID = "copilot-money";
export const CSV_FORMATS: Format[] = [
  {
    id: COPILOT_FORMAT_ID,
    label: "Copilot Money export (every account in one file)",
    verified: true,
    headers: [
      "date",
      "name",
      "amount",
      "status",
      "category",
      "parent category",
      "excluded",
      "tags",
      "type",
      "account",
      "account mask",
      "note",
      "recurring",
    ],
    date: "date",
    description: "name",
    amount: "amount",
    // Copilot stores spending as positive and credits or refunds as negative.
    sign: -1,
    account: { name: "account", mask: "account mask" },
    // Payments between the owner's own accounts are not purchases or credits, a pending row is
    // not final, and rows whose account Copilot no longer names cannot be placed.
    include: (r) =>
      r.type !== "internal transfer" &&
      r.status !== "pending" &&
      r.account.trim() !== "",
  },
  {
    id: "chase-card",
    label: "Chase credit card activity",
    verified: false,
    headers: [
      "transaction date",
      "post date",
      "description",
      "category",
      "type",
      "amount",
      "memo",
    ],
    date: "transaction date",
    posted: "post date",
    description: "description",
    amount: "amount",
    sign: 1,
  },
  {
    id: "amex",
    label: "American Express activity",
    verified: false,
    headers: ["date", "description", "amount"],
    date: "date",
    description: "description",
    amount: "amount",
    sign: -1,
  },
  {
    id: "discover",
    label: "Discover card activity",
    verified: false,
    headers: ["trans. date", "post date", "description", "amount", "category"],
    date: "trans. date",
    posted: "post date",
    description: "description",
    amount: "amount",
    sign: -1,
  },
  {
    id: "generic-signed",
    label: "Generic: Date, Description, Amount (negative = money out)",
    verified: true,
    headers: ["date", "description", "amount"],
    date: "date",
    description: "description",
    amount: "amount",
    sign: 1,
  },
];

// RFC 4180 parsing: quoted fields, escaped quotes, CRLF or LF line endings.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false;
  const input = text.replace(/^﻿/, "");
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"' && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (quoted) throw new Error("The file ends inside a quoted field.");
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

function isoDate(value: string): string {
  const v = value.trim();
  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    const iso = `${year}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
    if (!Number.isNaN(Date.parse(`${iso}T00:00:00Z`))) return iso;
  }
  throw new Error(`Unrecognized date: ${v.slice(0, 20)}`);
}
const money = (value: string) =>
  decimalToCents(value.replace(/[$,\s]/g, "").replace(/^\((.*)\)$/, "-$1"));
// Only exactly four digits identify an account; anything else is treated as no digits.
const lastFour = (value: string | undefined) =>
  /^\d{4}$/.test((value ?? "").trim()) ? (value ?? "").trim() : null;

export function detectFormat(header: string[], requested?: string): Format {
  const normalized = header.map((h) => h.trim().toLowerCase());
  const candidates = CSV_FORMATS.filter(
    (f) =>
      f.headers.length === normalized.length &&
      f.headers.every((h, i) => normalized[i] === h),
  );
  if (requested) {
    const f = candidates.find((c) => c.id === requested);
    if (!f)
      throw new Error("The file's columns do not match the chosen format.");
    return f;
  }
  // Two formats share Date, Description, Amount; their signs differ, so the owner must choose.
  if (candidates.length !== 1)
    throw new Error(
      candidates.length
        ? "Choose the file's format: its columns match more than one export."
        : "This CSV layout is not supported yet.",
    );
  return candidates[0];
}

export function parseStatement(text: string, requested?: string) {
  const [header, ...body] = parseCsv(text);
  if (!header) throw new Error("The file is empty.");
  const format = detectFormat(header, requested);
  const col = (name: string) =>
    header.findIndex((h) => h.trim().toLowerCase() === name);
  const at = {
    date: col(format.date),
    posted: format.posted ? col(format.posted) : -1,
    description: col(format.description),
    amount: col(format.amount),
  };
  const names = header.map((h) => h.trim().toLowerCase());
  const rows: CsvRow[] = [];
  body.forEach((cells, i) => {
    const record = Object.fromEntries(
      names.map((name, j) => [name, cells[j] ?? ""]),
    );
    if (format.include && !format.include(record)) return;
    try {
      rows.push({
        transactedOn: isoDate(cells[at.date] ?? ""),
        postedOn:
          at.posted >= 0 && cells[at.posted]?.trim()
            ? isoDate(cells[at.posted])
            : null,
        amountCents: format.sign * money(cells[at.amount] ?? ""),
        description: (cells[at.description] ?? "").trim().slice(0, 500),
        ...(format.account
          ? {
              account: {
                name: record[format.account.name].trim().slice(0, 200),
                mask: lastFour(record[format.account.mask]),
              },
            }
          : {}),
      });
    } catch (e) {
      throw new Error(
        `Row ${i + 2}: ${e instanceof Error ? e.message : "unreadable"}`,
      );
    }
  });
  const dates = rows.map((r) => r.transactedOn).sort();
  return {
    format,
    rows,
    coverageStart: dates[0] ?? null,
    coverageEnd: dates.at(-1) ?? null,
  };
}
