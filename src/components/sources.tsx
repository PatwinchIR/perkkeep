"use client";
import { useState, type FormEvent } from "react";
import { Link2, RefreshCw, Upload } from "lucide-react";
import { runSource } from "@/lib/api";
import { CSV_FORMATS } from "@/server/sources/csv";
import { accountFreshness, cardEnding, dateLabel } from "@/lib/domain";
import type { Account } from "@/lib/types";
import { useApp } from "./provider";
import { Empty } from "./ui";

const errorText = (e: unknown) =>
  e instanceof Error ? e.message : "Something went wrong.";
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString() : "never";
const FRESHNESS = {
  current: ["confirmed", "Current"],
  stale: ["needs_review", "Stale"],
  failing: ["needs_review", "Last sync failed"],
  never: ["needs_review", "Not synced yet"],
} as const;

export function SourcesPanel() {
  const { data, refresh, notice, offline } = useApp(),
    [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  async function act(label: string, fn: () => Promise<unknown>, done: string) {
    setBusy(label);
    setError("");
    try {
      await fn();
      await refresh();
      notice(done);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy("");
    }
  }
  async function connect(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      f = new FormData(form);
    await act(
      "connect",
      () =>
        runSource("connectSimplefin", {
          setup_token: String(f.get("token") ?? "").trim(),
          label: String(f.get("label") ?? "").trim(),
        }),
      "SimpleFIN connected. The first sync has run.",
    );
    form.reset();
  }
  const cardName = (id: string | null) => {
    const c = data.cards.find((x) => x.id === id);
    return c ? `${c.display_name} · ${cardEnding(c.last4)}` : "Unknown card";
  };
  return (
    <section className="sources" aria-labelledby="sources-title">
      <div className="section-heading">
        <h2 id="sources-title">Connected accounts</h2>
      </div>
      <p className="hint">
        Transactions are evidence for review. They never change a benefit
        balance by themselves, and accounts that are not linked to a confirmed
        card are never used for balances.
      </p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="settings-grid">
        <form className="settings-card form-stack" onSubmit={connect}>
          <h2>Connect SimpleFIN</h2>
          <p>
            Paste the setup token from SimpleFIN Bridge. PerkKeep claims it once
            on the server and stores the resulting access address encrypted. It
            is never shown again or sent to your browser.
          </p>
          <label>
            SimpleFIN setup token
            <textarea name="token" required rows={3} autoComplete="off" />
          </label>
          <label>
            Label (optional)
            <input name="label" maxLength={100} />
          </label>
          <button className="primary" disabled={!!busy || offline}>
            <Link2 size={16} />{" "}
            {busy === "connect" ? "Connecting…" : "Connect SimpleFIN"}
          </button>
        </form>
        <CsvImport
          accounts={data.accounts.filter((a) => a.source === "csv")}
          busy={!!busy || offline}
          onImport={(input) =>
            act(
              "import",
              async () => {
                const r = (await runSource("importCsv", input)) as {
                  replay: boolean;
                  added?: number;
                };
                if (r.replay)
                  throw new Error(
                    "This file was already imported; nothing changed.",
                  );
              },
              "File imported. Its date range is recorded as coverage.",
            )
          }
        />
      </div>
      {data.connections.length > 0 && (
        <div className="sync-log">
          {data.connections.map((c) => (
            <div key={c.id}>
              <div>
                <strong>
                  {c.source === "simplefin" ? "SimpleFIN" : "Plaid Sandbox"}
                  {c.label ? ` · ${c.label}` : ""}
                </strong>
                <span>
                  Last success {when(c.last_success_at)} · last attempt{" "}
                  {when(c.last_attempted_at)}
                </span>
                {c.last_error && <p className="form-error">{c.last_error}</p>}
                <p>
                  SimpleFIN refreshes banks about once a day, so a sync shortly
                  after another usually finds nothing new.
                </p>
              </div>
              <button
                className="secondary"
                disabled={!!busy || offline}
                onClick={() =>
                  void act(
                    c.id,
                    () => runSource("syncConnection", { connection_id: c.id }),
                    "Sync finished.",
                  )
                }
              >
                <RefreshCw size={15} />{" "}
                {busy === c.id ? "Syncing…" : "Sync now"}
              </button>
            </div>
          ))}
        </div>
      )}
      {data.accounts.length ? (
        <div className="account-list">
          {data.accounts.map((a) => (
            <AccountRow
              key={a.id}
              account={a}
              cardName={cardName}
              busy={!!busy || offline}
              act={act}
            />
          ))}
        </div>
      ) : (
        <Empty title="No accounts yet.">
          Connect SimpleFIN or import a statement CSV. Accounts appear here
          unlinked until you confirm which card each one is.
        </Empty>
      )}
    </section>
  );
}

function AccountRow({
  account: a,
  cardName,
  busy,
  act,
}: {
  account: Account;
  cardName: (id: string | null) => string;
  busy: boolean;
  act: (
    label: string,
    fn: () => Promise<unknown>,
    done: string,
  ) => Promise<void>;
}) {
  const { data } = useApp(),
    [choice, setChoice] = useState("");
  const [badge, label] = FRESHNESS[accountFreshness(a)];
  return (
    <article className="account-row">
      <div>
        <strong>
          {a.institution || "Unknown institution"} · {a.name}
          {a.mask ? ` · ending ${a.mask}` : ""}
        </strong>
        <span>
          {a.source.toUpperCase()} · {a.transaction_rows} transaction records ·{" "}
          {a.earliest_synced_on && a.synced_through
            ? `covers ${dateLabel(a.earliest_synced_on)} – ${dateLabel(a.synced_through)}`
            : "no coverage recorded"}
        </span>
        {a.last_error && <p className="form-error">{a.last_error}</p>}
        {a.mapping_status === "confirmed" && (
          <p>Linked to {cardName(a.card_id)} (you confirmed this).</p>
        )}
        {a.mapping_status === "proposed" && (
          <p>
            Suggested: {cardName(a.proposed_card_id)}, based on the institution
            and last four digits. Not used until you confirm.
          </p>
        )}
        {a.mapping_status === "rejected" && (
          <p>
            You marked the suggestion as wrong. Choose the right card below.
          </p>
        )}
      </div>
      <div className="account-actions">
        <span className={`badge ${badge}`}>{label}</span>
        {a.mapping_status === "proposed" && a.proposed_card_id && (
          <>
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void act(
                  a.id,
                  () =>
                    runSource("confirmMapping", {
                      account_id: a.id,
                      card_id: a.proposed_card_id!,
                    }),
                  "Account linked to the card.",
                )
              }
            >
              Confirm link
            </button>
            <button
              className="text-button"
              disabled={busy}
              onClick={() =>
                void act(
                  a.id,
                  () => runSource("rejectMapping", { account_id: a.id }),
                  "Suggestion dismissed.",
                )
              }
            >
              Not this card
            </button>
          </>
        )}
        {(a.mapping_status === "unmapped" ||
          a.mapping_status === "rejected") && (
          <>
            <label className="sr-label">
              Card for {a.name}
              <select
                value={choice}
                onChange={(e) => setChoice(e.target.value)}
              >
                <option value="">Choose a card…</option>
                {data.cards.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.display_name} · {cardEnding(c.last4)}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="secondary"
              disabled={busy || !choice}
              onClick={() =>
                void act(
                  a.id,
                  () =>
                    runSource("confirmMapping", {
                      account_id: a.id,
                      card_id: choice,
                    }),
                  "Account linked to the card.",
                )
              }
            >
              Link card
            </button>
          </>
        )}
      </div>
    </article>
  );
}

function CsvImport({
  accounts,
  busy,
  onImport,
}: {
  accounts: Account[];
  busy: boolean;
  onImport: (input: {
    file_name: string;
    file_text: string;
    format?: string;
    account_id?: string;
    new_account?: { institution: string; name: string; mask: string | null };
  }) => Promise<void>;
}) {
  const [target, setTarget] = useState("new");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      f = new FormData(form),
      file = f.get("file") as File | null;
    if (!file || !file.size) return;
    const text = (k: string) => String(f.get(k) ?? "").trim();
    await onImport({
      file_name: file.name.slice(0, 200),
      file_text: await file.text(),
      format: text("format") || undefined,
      ...(target === "new"
        ? {
            new_account: {
              institution: text("institution"),
              name: text("account_name"),
              mask: text("mask") || null,
            },
          }
        : { account_id: target }),
    });
    form.reset();
  }
  return (
    <form className="settings-card form-stack" onSubmit={submit}>
      <h2>Import a statement CSV</h2>
      <p>
        Each file is imported once. Its own first and last transaction dates are
        recorded as coverage. Issuer layouts marked unverified are based on
        typical exports; check the result after importing.
      </p>
      <label>
        CSV file
        <input name="file" type="file" accept=".csv,text/csv" required />
      </label>
      <label>
        File layout
        <select name="format" defaultValue="">
          <option value="">Detect from the columns</option>
          {CSV_FORMATS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
              {f.verified ? "" : " (layout unverified)"}
            </option>
          ))}
        </select>
      </label>
      <label>
        Import into
        <select value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="new">A new account…</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.institution} · {a.name}
            </option>
          ))}
        </select>
      </label>
      {target === "new" && (
        <>
          <label>
            Institution
            <input name="institution" required maxLength={200} />
          </label>
          <label>
            Account name
            <input name="account_name" required maxLength={200} />
          </label>
          <label>
            Last four digits (optional)
            <input
              name="mask"
              inputMode="numeric"
              pattern="[0-9]{4}"
              maxLength={4}
            />
          </label>
        </>
      )}
      <button className="primary" disabled={busy}>
        <Upload size={16} /> Import file
      </button>
    </form>
  );
}
