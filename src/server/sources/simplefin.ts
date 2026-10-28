import "server-only";
import {
  decimalToCents,
  type SourceAdapter,
  type SourceAccount,
  type SourceBatch,
  type SourceTransaction,
  type SyncWindow,
} from "./types";

// SimpleFIN protocol, https://www.simplefin.org/protocol.html (read 2026-10-28). Version 2 responses
// link accounts to "connections" by conn_id; version 1 responses carry an "org" object per account.
// Both are accepted.
type Fetch = typeof fetch;

export function setupTokenClaimUrl(token: string): URL {
  let decoded: string;
  try {
    decoded = Buffer.from(token.trim(), "base64").toString("utf8").trim();
  } catch {
    throw new Error("That is not a SimpleFIN setup token.");
  }
  let url: URL;
  try {
    url = new URL(decoded);
  } catch {
    throw new Error("That is not a SimpleFIN setup token.");
  }
  if (url.protocol !== "https:")
    throw new Error("SimpleFIN claim URLs must use HTTPS.");
  return url;
}

// Exchanges a one-time setup token for the access URL. The token cannot be used again afterwards.
export async function claimSetupToken(
  token: string,
  fetcher: Fetch = fetch,
): Promise<string> {
  const response = await fetcher(setupTokenClaimUrl(token), {
    method: "POST",
    headers: { "Content-Length": "0" },
    signal: AbortSignal.timeout(20000),
  });
  if (response.status === 403)
    throw new Error(
      "SimpleFIN refused this token: it was already claimed or does not exist. If you did not claim it, revoke it in SimpleFIN Bridge.",
    );
  if (!response.ok)
    throw new Error(`SimpleFIN claim failed with status ${response.status}.`);
  const accessUrl = (await response.text()).trim();
  const parsed = new URL(accessUrl);
  if (parsed.protocol !== "https:" || !parsed.username || !parsed.password)
    throw new Error("SimpleFIN returned an unexpected access URL.");
  return accessUrl;
}

type RawTransaction = {
  id: string;
  posted: number;
  amount: string;
  description?: string;
  payee?: string;
  transacted_at?: number;
  pending?: boolean;
};
type RawAccount = {
  id: string;
  name: string;
  conn_id?: string;
  org?: { name?: string; domain?: string };
  currency: string;
  balance: string;
  "available-balance"?: string;
  "balance-date": number;
  transactions?: RawTransaction[];
};
type RawSet = {
  errlist?: { code: string; msg: string; account_id?: string }[];
  errors?: string[];
  connections?: { conn_id: string; name: string }[];
  accounts: RawAccount[];
};

const day = (epochSeconds: number, timeZone = "America/New_York") =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(epochSeconds * 1000));
const epoch = (isoDay: string) =>
  Math.floor(Date.parse(`${isoDay}T00:00:00Z`) / 1000);

// Card account names usually end with the last four digits, often in parentheses, as in
// "Sapphire Reserve (1234)"; nothing else is inferred.
export function maskFrom(name: string): string | null {
  const m = name.match(/(?:\.\.\.|x|\*|-|\s|\()(\d{4})\)?\s*$/i);
  return m ? m[1] : null;
}
function kindFrom(name: string): SourceAccount["kind"] {
  if (
    /card|credit|visa|mastercard|amex|express|sapphire|freedom|ink/i.test(name)
  )
    return "credit";
  if (/checking|savings|deposit/i.test(name)) return "depository";
  if (/brokerage|ira|401k|invest/i.test(name)) return "investment";
  return "unknown";
}

export function normalizeAccountSet(raw: RawSet): SourceBatch {
  const connections = new Map(
    (raw.connections ?? []).map((c) => [c.conn_id, c.name]),
  );
  const accountErrors = new Map<string, string>();
  const messages: string[] = [];
  for (const e of raw.errlist ?? []) {
    if (e.account_id) accountErrors.set(e.account_id, `${e.code}: ${e.msg}`);
    messages.push(`${e.code}: ${e.msg}`.slice(0, 300));
  }
  for (const e of raw.errors ?? []) messages.push(String(e).slice(0, 300));
  const accounts: SourceAccount[] = [];
  const transactions: SourceTransaction[] = [];
  for (const a of raw.accounts ?? []) {
    accounts.push({
      externalId: a.id,
      institution:
        (a.conn_id && connections.get(a.conn_id)) ||
        a.org?.name ||
        a.org?.domain ||
        "",
      name: a.name,
      mask: maskFrom(a.name),
      kind: kindFrom(a.name),
      currency: /^[A-Z]{3}$/.test(a.currency) ? a.currency : "USD",
      balanceCents: a.balance != null ? decimalToCents(a.balance) : null,
      availableCents:
        a["available-balance"] != null
          ? decimalToCents(a["available-balance"])
          : null,
      balanceObservedAt: a["balance-date"]
        ? new Date(a["balance-date"] * 1000).toISOString()
        : null,
      error: accountErrors.get(a.id) ?? null,
    });
    for (const t of a.transactions ?? []) {
      const pending = t.pending === true || !t.posted;
      const when = t.transacted_at || t.posted;
      if (!when) continue;
      transactions.push({
        accountExternalId: a.id,
        externalId: t.id,
        transactedOn: day(when),
        postedOn: pending ? null : day(t.posted),
        amountCents: decimalToCents(t.amount),
        description: (t.description || t.payee || "").slice(0, 500),
        pending,
      });
    }
  }
  return { accounts, transactions, messages, explicitRemovals: false };
}

export function simplefinAdapter(fetcher: Fetch = fetch): SourceAdapter {
  return {
    source: "simplefin",
    async fetch(accessUrl: string, window: SyncWindow) {
      const base = new URL(accessUrl);
      const auth = Buffer.from(
        `${decodeURIComponent(base.username)}:${decodeURIComponent(base.password)}`,
      ).toString("base64");
      base.username = "";
      base.password = "";
      const url = new URL(`${base.toString().replace(/\/$/, "")}/accounts`);
      url.searchParams.set("start-date", String(epoch(window.start)));
      url.searchParams.set("end-date", String(epoch(window.endExclusive)));
      url.searchParams.set("pending", "1");
      url.searchParams.set("version", "2");
      const response = await fetcher(url, {
        headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
        signal: AbortSignal.timeout(60000),
      });
      if (response.status === 403)
        throw new Error(
          "SimpleFIN access was revoked or the credentials are wrong. Reconnect in Settings.",
        );
      if (!response.ok)
        throw new Error(`SimpleFIN returned status ${response.status}.`);
      return normalizeAccountSet((await response.json()) as RawSet);
    },
  };
}
