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
    [error, setError] = useState(""),
    [replacing, setReplacing] = useState(false);
  const linked = data.connections.filter(
    (c) => c.source === "simplefin" && c.status !== "revoked",
  );
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
      "SimpleFIN connected. The first sync has run and your card accounts are linked.",
    );
    form.reset();
    setReplacing(false);
  }
  const cardName = (id: string | null) => {
    const c = data.cards.find((x) => x.id === id);
    return c ? `${c.display_name} · ${cardEnding(c.last4)}` : "Unknown card";
  };
  const attention = linked.some((c) => c.last_error),
    others = data.connections.filter((c) => !linked.includes(c));
  return (
    <section className="settings-section" aria-labelledby="sources-title">
      <h2 id="sources-title">Connected accounts</h2>
      <p>
        Each synced card account becomes one of your cards and is linked to it.
        PerkKeep matches transactions on linked accounts to your benefits after
        every sync. Matches wait in Review until you confirm them, except issuer
        credits whose description has been verified. Unlinked accounts are never
        used.
      </p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="settings-group">
        <div className="settings-row">
          <span className="metric-icon">
            <Link2 size={18} />
          </span>
          <div className="settings-row-text">
            <h3>SimpleFIN</h3>
            {linked.length > 0 && !replacing ? (
              <>
                {linked.map((c) => (
                  <div key={c.id}>
                    <p>
                      {c.label ? `${c.label} · ` : ""}
                      {plural(
                        data.accounts.filter((a) => a.connection_id === c.id)
                          .length,
                        "account",
                      )}{" "}
                      · last success {when(c.last_success_at)}. PerkKeep syncs
                      once a day on its own; SimpleFIN refreshes banks about
                      once a day.
                    </p>
                    {c.last_error && (
                      <p className="form-error">{c.last_error}</p>
                    )}
                    <div className="settings-row-actions">
                      <SyncButton
                        id={c.id}
                        busy={busy}
                        offline={offline}
                        act={act}
                      />
                    </div>
                  </div>
                ))}
                <div className="settings-row-actions">
                  <button
                    className="text-button"
                    disabled={!!busy || offline}
                    onClick={() => setReplacing(true)}
                  >
                    Replace with a new setup token
                  </button>
                </div>
              </>
            ) : (
              <>
                <p>
                  Paste the setup token from SimpleFIN Bridge. PerkKeep claims
                  it once on the server and stores the resulting access address
                  encrypted. It is never shown again or sent to your browser.
                </p>
                <form className="form-stack" onSubmit={connect}>
                  <label>
                    SimpleFIN setup token
                    <textarea
                      name="token"
                      required
                      rows={3}
                      autoComplete="off"
                    />
                  </label>
                  <label>
                    Label (optional)
                    <input name="label" maxLength={100} />
                  </label>
                  <div className="settings-row-actions">
                    <button className="primary" disabled={!!busy || offline}>
                      <Link2 size={16} />{" "}
                      {busy === "connect" ? "Connecting…" : "Connect SimpleFIN"}
                    </button>
                    {replacing && (
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setReplacing(false)}
                      >
                        Keep the current connection
                      </button>
                    )}
                  </div>
                </form>
              </>
            )}
          </div>
          <span
            className={`badge ${!linked.length ? "" : attention ? "needs_review" : "confirmed"}`}
          >
            {!linked.length
              ? "Not connected"
              : attention
                ? "Needs attention"
                : "Linked"}
          </span>
        </div>
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
        {others.map((c) => (
          <div className="settings-row" key={c.id}>
            <span className="metric-icon">
              <Link2 size={18} />
            </span>
            <div className="settings-row-text">
              <h3>
                {c.source === "simplefin" ? "SimpleFIN" : "Plaid Sandbox"}
                {c.label ? ` · ${c.label}` : ""}
              </h3>
              <p>
                Last success {when(c.last_success_at)} · last attempt{" "}
                {when(c.last_attempted_at)}
              </p>
              {c.last_error && <p className="form-error">{c.last_error}</p>}
            </div>
            <SyncButton id={c.id} busy={busy} offline={offline} act={act} />
          </div>
        ))}
      </div>
      <div className="settings-subheading">
        <h3>Accounts</h3>
        <span className="count">{data.accounts.length}</span>
        <button
          className="secondary"
          disabled={!!busy || offline || !data.accounts.length}
          onClick={() =>
            void act(
              "match",
              () => runSource("runMatchers", {}),
              "Matching finished. New matches are waiting in Review.",
            )
          }
        >
          {busy === "match" ? "Matching…" : "Match transactions now"}
        </button>
      </div>
      {data.accounts.length ? (
        <div className="settings-group">
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
          Connect SimpleFIN or import a statement CSV. Synced card accounts
          appear here, each linked to its card.
        </Empty>
      )}
    </section>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function SyncButton({
  id,
  busy,
  offline,
  act,
}: {
  id: string;
  busy: string;
  offline: boolean;
  act: (
    label: string,
    fn: () => Promise<unknown>,
    done: string,
  ) => Promise<void>;
}) {
  return (
    <button
      className="secondary"
      disabled={!!busy || offline}
      onClick={() =>
        void act(
          id,
          () => runSource("syncConnection", { connection_id: id }),
          "Sync finished.",
        )
      }
    >
      <RefreshCw size={15} /> {busy === id ? "Syncing…" : "Sync now"}
    </button>
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
          <p>Linked to {cardName(a.card_id)}.</p>
        )}
        {a.mapping_status === "proposed" && (
          <p>
            Suggested: {cardName(a.proposed_card_id)}, based on the institution
            and last four digits. Not used until you confirm.
          </p>
        )}
        {a.mapping_status === "rejected" && (
          <p>Unlinked. Choose the right card below.</p>
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
        {a.mapping_status === "confirmed" && (
          <button
            className="text-button"
            disabled={busy}
            onClick={() =>
              void act(
                a.id,
                () => runSource("rejectMapping", { account_id: a.id }),
                "Account unlinked. It is no longer used for matching.",
              )
            }
          >
            Unlink
          </button>
        )}
        {(a.mapping_status === "unmapped" ||
          a.mapping_status === "rejected") && (
          <>
            <label>
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
    <div className="settings-row">
      <span className="metric-icon">
        <Upload size={18} />
      </span>
      <div className="settings-row-text">
        <h3>Statement CSV</h3>
        <p>
          Each file is imported once. Its own first and last transaction dates
          are recorded as coverage. Issuer layouts marked unverified are based
          on typical exports; check the result after importing.
        </p>
        <details className="settings-disclosure">
          <summary>Import a statement CSV</summary>
          <form className="form-stack" onSubmit={submit}>
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
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
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
            <div className="settings-row-actions">
              <button className="primary" disabled={busy}>
                <Upload size={16} /> Import file
              </button>
            </div>
          </form>
        </details>
      </div>
    </div>
  );
}
