import "server-only";
import {
  decimalToCents,
  type SourceAccount,
  type SourceAdapter,
  type SourceBatch,
  type SourceTransaction,
} from "./types";

// Plaid /transactions/sync adapter, Sandbox only (brief section 5). Written against Plaid's
// documented API from memory; NOT yet run against Plaid. Production Items are never created here.
// The stored secret is JSON {access_token, cursor}. Plaid amounts are positive for money leaving the
// account, so they are negated into PerkKeep's convention.
type Fetch = typeof fetch;
const SANDBOX = "https://sandbox.plaid.com";

function credentials() {
  const client_id = process.env.PLAID_CLIENT_ID,
    secret = process.env.PLAID_SECRET;
  if (!client_id || !secret)
    throw new Error("Plaid Sandbox credentials are not configured.");
  if ((process.env.PLAID_ENV ?? "sandbox") !== "sandbox")
    throw new Error("Only Plaid Sandbox is enabled.");
  return { client_id, secret };
}

async function call<T>(fetcher: Fetch, path: string, body: object): Promise<T> {
  const response = await fetcher(`${SANDBOX}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...credentials(), ...body }),
    signal: AbortSignal.timeout(60000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      `Plaid ${path} failed: ${data?.error_code ?? response.status}`,
    );
  return data as T;
}

const cents = (amount: number) => decimalToCents(String(amount));
type PlaidTx = {
  transaction_id: string;
  account_id: string;
  amount: number;
  date: string;
  authorized_date?: string | null;
  name?: string;
  merchant_name?: string | null;
  pending: boolean;
};

export function plaidAdapter(fetcher: Fetch = fetch): SourceAdapter {
  return {
    source: "plaid",
    async fetch(secret: string): Promise<SourceBatch> {
      const state = JSON.parse(secret) as {
        access_token: string;
        cursor?: string;
      };
      let cursor = state.cursor ?? "";
      const transactions: SourceTransaction[] = [];
      const toTx = (t: PlaidTx, removed = false): SourceTransaction => ({
        accountExternalId: t.account_id,
        externalId: t.transaction_id,
        transactedOn: t.authorized_date ?? t.date,
        postedOn: t.pending ? null : t.date,
        amountCents: -cents(t.amount),
        description: (t.merchant_name || t.name || "").slice(0, 500),
        pending: t.pending,
        removed,
      });
      let accounts: SourceAccount[] = [];
      for (let page = 0; page < 50; page++) {
        const r = await call<{
          added: PlaidTx[];
          modified: PlaidTx[];
          removed: { transaction_id: string; account_id: string }[];
          next_cursor: string;
          has_more: boolean;
          accounts?: {
            account_id: string;
            name: string;
            official_name?: string | null;
            mask?: string | null;
            type: string;
            balances: {
              current: number | null;
              available: number | null;
              iso_currency_code?: string | null;
            };
          }[];
        }>(fetcher, "/transactions/sync", {
          access_token: state.access_token,
          cursor: cursor || undefined,
          count: 500,
        });
        for (const t of [...r.added, ...r.modified]) transactions.push(toTx(t));
        for (const t of r.removed)
          transactions.push({
            accountExternalId: t.account_id,
            externalId: t.transaction_id,
            transactedOn: "",
            postedOn: null,
            amountCents: 0,
            description: "",
            pending: false,
            removed: true,
          });
        if (r.accounts)
          accounts = r.accounts.map((a) => ({
            externalId: a.account_id,
            institution: "",
            name: a.official_name || a.name,
            mask: /^\d{4}$/.test(a.mask ?? "") ? a.mask! : null,
            kind: (["credit", "depository", "investment", "loan"].includes(
              a.type,
            )
              ? a.type
              : "other") as SourceAccount["kind"],
            currency: a.balances.iso_currency_code || "USD",
            // Plaid reports a credit card's current balance as amount owed; store it as negative.
            balanceCents:
              a.balances.current == null
                ? null
                : (a.type === "credit" ? -1 : 1) * cents(a.balances.current),
            availableCents:
              a.balances.available == null ? null : cents(a.balances.available),
            balanceObservedAt: new Date().toISOString(),
            error: null,
          }));
        cursor = r.next_cursor;
        if (!r.has_more) break;
      }
      return {
        accounts,
        transactions,
        messages: [],
        explicitRemovals: true,
        nextSecret: JSON.stringify({ ...state, cursor }),
      };
    },
  };
}

// Sandbox-only helper for tests: creates a sandbox Item and returns its access token.
export async function createSandboxItem(fetcher: Fetch = fetch) {
  const { public_token } = await call<{ public_token: string }>(
    fetcher,
    "/sandbox/public_token/create",
    { institution_id: "ins_109508", initial_products: ["transactions"] },
  );
  const { access_token } = await call<{ access_token: string }>(
    fetcher,
    "/item/public_token/exchange",
    { public_token },
  );
  return JSON.stringify({ access_token });
}
