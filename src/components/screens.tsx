"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  CheckCheck,
  ClipboardCheck,
  Clock3,
  Database,
  Plus,
  Search,
  ShieldCheck,
  Smartphone,
  LogOut,
  SlidersHorizontal,
  WalletCards,
  WifiOff,
} from "lucide-react";
import { useApp } from "./provider";
import { CardTile, Empty, PageHeading } from "./ui";
import { PeriodPanel } from "./period-panel";
import { BenefitForm, CardForm, CoverageForm } from "./forms";
import {
  activePeriod,
  cardEnding,
  CADENCES,
  knownAvailable,
  localDate,
  money,
  reviewReason,
  shiftDays,
  sortReview,
  status,
} from "@/lib/domain";
import type { Benefit } from "@/lib/types";

export function Dashboard() {
  const { data, db, refresh, notice, offline } = useApp(),
    [issuer, setIssuer] = useState("all"),
    [cardFilter, setCardFilter] = useState("all"),
    [cadence, setCadence] = useState("all"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const today = localDate(),
    current = data.periods.filter(
      (p) =>
        activePeriod(
          p,
          data.benefits.find((b) => b.id === p.benefit_id),
        ) &&
        p.enabled &&
        p.card_status === "active",
    ),
    filtered = current.filter(
      (p) =>
        (issuer === "all" || p.issuer === issuer) &&
        (cardFilter === "all" || p.card_id === cardFilter) &&
        (cadence === "all" || p.cadence === cadence),
    ),
    eligible = filtered.filter(
      (p) =>
        p.eligibility_status === "eligible" &&
        (!p.enrollment_required || p.enrollment_status === "active"),
    ),
    known = eligible
      .map((p) => knownAvailable(p))
      .filter((n): n is number => n !== null);
  const monetary = eligible.filter((p) => p.allowance_cents !== null),
    used = monetary.reduce((n, p) => n + p.confirmed_cents, 0),
    candidates = monetary.reduce((n, p) => n + p.candidate_cents, 0);
  const expiring = filtered
      .filter(
        (p) =>
          p.period_end_exclusive <= shiftDays(today, 15) &&
          (knownAvailable(p) ?? 0) > 0,
      )
      .sort(sortReview),
    review = filtered.filter(
      (p) => status(p) === "needs_review" || status(p) === "candidate",
    );
  const cards = data.cards.filter(
    (c) =>
      (issuer === "all" || c.issuer === issuer) &&
      (cardFilter === "all" || c.id === cardFilter) &&
      (cadence === "all" || filtered.some((p) => p.card_id === c.id)),
  );
  async function setup() {
    setBusy(true);
    const { error } = await db.rpc("initialize_cards");
    if (error) setError(error.message);
    else {
      await refresh();
      notice(
        "Your cards are added. Confirm their current identities before adding benefits.",
      );
    }
    setBusy(false);
  }
  return (
    <>
      <PageHeading
        eyebrow={new Intl.DateTimeFormat("en-US", {
          month: "long",
          year: "numeric",
          timeZone: "America/New_York",
        })
          .format(new Date())
          .toUpperCase()}
        title="Good things, kept in view."
        description="A little clarity for every benefit in your wallet."
        action={
          <Link className="secondary" href="/review">
            Review benefits <ArrowUpRight size={16} />
          </Link>
        }
      />
      <div className="summary-grid">
        <section className="summary-main">
          <div className="summary-label">
            KNOWN AVAILABLE{" "}
            <span className="tiny-pill">
              {known.length
                ? "Your verified snapshot"
                : "Awaiting verification"}
            </span>
          </div>
          <div className="summary-value">
            {known.length ? money(known.reduce((a, b) => a + b, 0)) : "—"}
          </div>
          <p>
            {known.length
              ? `Across ${known.length} ${known.length === 1 ? "benefit" : "benefits"} with verified eligibility and coverage`
              : "Available value will appear after eligibility and coverage are verified."}
          </p>
          <div className="summary-bottom">
            <ShieldCheck size={15} /> Candidates never reduce this balance.
          </div>
        </section>
        <section className="summary-small">
          <span className="metric-icon">
            <CheckCheck size={20} />
          </span>
          <span>Confirmed used</span>
          <strong>{monetary.length ? money(used) : "—"}</strong>
          <small>Supported by recorded evidence</small>
        </section>
        <section className="summary-small">
          <span className="metric-icon amber">
            <Search size={20} />
          </span>
          <span>Potentially qualifying</span>
          <strong>{monetary.length ? money(candidates) : "—"}</strong>
          <small>Purchases awaiting confirmation</small>
        </section>
      </div>
      <div className="attention-strip">
        <Link href="/review">
          <Clock3 size={18} />
          <strong>{expiring.length} expiring soon</strong>
          <span>Next 14 days</span>
          <ArrowRight size={16} />
        </Link>
        <Link href="/review">
          <SlidersHorizontal size={18} />
          <strong>
            {review.length +
              data.cards.filter((c) => !c.identity_verified_at).length}{" "}
            need a closer look
          </strong>
          <span>Details or evidence to review</span>
          <ArrowRight size={16} />
        </Link>
      </div>
      <div className="section-heading">
        <div>
          <span className="eyebrow">THE EVERYDAY COLLECTION</span>
          <h2>
            Your cards <span className="count">{data.cards.length}</span>
          </h2>
        </div>
        <Link href="/cards">
          Manage cards <ArrowUpRight size={15} />
        </Link>
      </div>
      <div className="filter-row">
        <label>
          <span className="sr-only">Filter by issuer</span>
          <select
            aria-label="Filter by issuer"
            value={issuer}
            onChange={(e) => setIssuer(e.target.value)}
          >
            <option value="all">All issuers</option>
            {Array.from(new Set(data.cards.map((c) => c.issuer))).map((i) => (
              <option key={i}>{i}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Filter by card</span>
          <select
            aria-label="Filter by card"
            value={cardFilter}
            onChange={(e) => setCardFilter(e.target.value)}
          >
            <option value="all">All cards</option>
            {data.cards.map((c) => (
              <option key={c.id} value={c.id}>
                {c.display_name} · {cardEnding(c.last4)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Filter by timeframe</span>
          <select
            aria-label="Filter by timeframe"
            value={cadence}
            onChange={(e) => setCadence(e.target.value)}
          >
            <option value="all">All reset timeframes</option>
            {Object.entries(CADENCES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>
      {data.cards.length === 0 ? (
        <Empty
          title="Let’s get your cards together."
          action={
            <button
              className="primary"
              disabled={busy || offline}
              onClick={() => void setup()}
            >
              <Plus size={16} /> Set up my cards
            </button>
          }
        >
          Start with your known cards, including Ink Business Cash and Ink
          Business Preferred. Their identities and benefits stay unverified
          until you check them.
        </Empty>
      ) : cards.length ? (
        <div className="cards-grid">
          {cards.map((c) => (
            <CardTile
              key={c.id}
              card={c}
              periods={filtered.filter((p) => p.card_id === c.id)}
            />
          ))}
        </div>
      ) : (
        <Empty title="No cards in this view.">
          Try a different issuer or timeframe.
        </Empty>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {data.periodErrors.length > 0 && (
        <div className="notice">
          <strong>Some periods need setup</strong>
          {data.periodErrors.map((e) => (
            <p key={e}>{e}</p>
          ))}
        </div>
      )}
      <div className="section-heading lower">
        <div>
          <span className="eyebrow">BEFORE THE WINDOW CLOSES</span>
          <h2>Worth remembering</h2>
        </div>
        <Link href="/review">
          See review queue <ArrowUpRight size={15} />
        </Link>
      </div>
      {expiring.length ? (
        expiring.slice(0, 3).map((p) => <PeriodPanel period={p} key={p.id} />)
      ) : (
        <div className="quiet-note">
          <span className="metric-icon">
            <Clock3 size={21} />
          </span>
          <div>
            <strong>
              {current.length
                ? "Nothing verified to expire soon."
                : "Your next opportunity starts with a verified benefit."}
            </strong>
            <p>
              {current.length
                ? "Only known, eligible balances appear here. Benefits with missing coverage stay in review."
                : "Open a card to confirm its details and add a benefit from current issuer terms."}
            </p>
          </div>
        </div>
      )}
    </>
  );
}

export function CardsScreen() {
  const { data } = useApp();
  return (
    <>
      <PageHeading
        eyebrow="YOUR WALLET"
        title="Every card has a story."
        description="Confirm the details, then keep track of what comes with them."
      />
      {data.cards.length ? (
        <div className="cards-grid">
          {data.cards.map((c) => (
            <CardTile
              key={c.id}
              card={c}
              periods={data.periods.filter(
                (p) =>
                  p.card_id === c.id &&
                  activePeriod(
                    p,
                    data.benefits.find((b) => b.id === p.benefit_id),
                  ),
              )}
            />
          ))}
        </div>
      ) : (
        <Empty
          title="Your collection is waiting."
          action={
            <Link className="primary" href="/">
              Set up your cards
            </Link>
          }
        >
          Start with your known cards from the overview.
        </Empty>
      )}
    </>
  );
}

export function CardScreen({ id }: { id: string }) {
  const { data, db, refresh, notice, offline } = useApp(),
    [modal, setModal] = useState<"card" | "benefit" | null>(null),
    [previous, setPrevious] = useState<Benefit | undefined>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const card = data.cards.find((c) => c.id === id);
  if (!card)
    return (
      <Empty
        title="Card not found."
        action={<Link href="/cards">Back to my cards</Link>}
      >
        This card is unavailable to your account.
      </Empty>
    );
  const benefits = data.benefits.filter((b) => b.card_id === id),
    periods = data.periods.filter(
      (p) =>
        p.card_id === id &&
        activePeriod(
          p,
          benefits.find((b) => b.id === p.benefit_id),
        ),
    );
  async function historical(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    const { error } = await db.rpc("ensure_period", {
      p_benefit_id: String(f.get("benefit")),
      p_on: String(f.get("day")),
    });
    if (error) setError(error.message);
    else {
      await refresh();
      notice("Period preserved. Open History to see earlier periods.");
    }
    setBusy(false);
  }
  async function pause(b: Benefit) {
    setBusy(true);
    const { error } = await db
      .from("benefits")
      .update({ enabled: !b.enabled })
      .eq("id", b.id);
    if (error) setError(error.message);
    else {
      await refresh();
      notice(b.enabled ? "Rule paused; history retained." : "Rule enabled.");
    }
    setBusy(false);
  }
  return (
    <>
      <Link className="back-link" href="/cards">
        ← My cards
      </Link>
      <PageHeading
        eyebrow={`${card.issuer} · ${cardEnding(card.last4)}`}
        title={card.display_name}
        description={
          card.product_name ??
          "This card’s product still needs to be identified."
        }
        action={
          <button
            className="secondary"
            disabled={offline}
            onClick={() => setModal("card")}
          >
            {card.identity_verified_at
              ? "Edit card details"
              : "Confirm card identity"}{" "}
            <ArrowUpRight size={16} />
          </button>
        }
      />
      {!card.identity_verified_at && (
        <div className="notice">
          <strong>First, make sure this is the right card.</strong>
          <p>
            Confirm its current product with your issuer before enabling any
            product-specific benefits. We haven’t assigned any entitlements.
          </p>
        </div>
      )}
      <div className="section-heading">
        <h2>Benefit periods</h2>
        <button
          className="primary"
          disabled={
            !card.identity_verified_at || card.status !== "active" || offline
          }
          onClick={() => {
            setPrevious(undefined);
            setModal("benefit");
          }}
        >
          <Plus size={16} /> Add benefit
        </button>
      </div>
      {benefits.length === 0 ? (
        <Empty title="A clean start for this card.">
          Add a benefit using current issuer terms. Nothing is assumed from the
          card’s name alone.
        </Empty>
      ) : (
        Object.entries(CADENCES)
          .filter(([key]) => benefits.some((b) => b.cadence === key))
          .map(([key, label]) => (
            <section key={key} className="cadence-section">
              <h3 className="group-heading">{label}</h3>
              {benefits
                .filter((b) => b.cadence === key)
                .map((b) => {
                  const p = periods.find((p) => p.benefit_id === b.id);
                  return (
                    <div key={b.id}>
                      {p ? (
                        <PeriodPanel period={p} />
                      ) : (
                        <div className="rule-without-period">
                          <strong>{b.name}</strong>
                          <span>
                            {!b.enabled
                              ? "Paused"
                              : b.effective_to && b.effective_to <= localDate()
                                ? "Previous rule version"
                                : "Period not established — check reset dates and eligibility"}
                          </span>
                        </div>
                      )}
                      <div className="rule-actions">
                        <span>
                          Terms verified{" "}
                          {b.verified_at
                            ? new Date(b.verified_at).toLocaleDateString()
                            : "not yet"}
                        </span>
                        {(!b.effective_to || b.effective_to > localDate()) && (
                          <>
                            <button
                              className="text-button"
                              disabled={offline || busy}
                              onClick={() => {
                                setPrevious(b);
                                setModal("benefit");
                              }}
                            >
                              Update terms with a new version
                            </button>
                            <button
                              className="text-button"
                              disabled={offline || busy}
                              onClick={() => void pause(b)}
                            >
                              {b.enabled ? "Pause rule" : "Enable rule"}
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
            </section>
          ))
      )}
      {benefits.some((b) => b.enabled) && (
        <details className="history-tool">
          <summary>Open a period for an earlier date</summary>
          <p>
            Use a date covered by the verified rule. Existing periods and
            evidence are retained.
          </p>
          <form onSubmit={historical} className="form-row">
            <label>
              Benefit
              <select name="benefit">
                {benefits
                  .filter((b) => b.enabled)
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} · from {b.effective_from}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Date in period
              <input name="day" type="date" required max={localDate()} />
            </label>
            <button className="secondary" disabled={busy || offline}>
              Open period
            </button>
          </form>
        </details>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {data.periodErrors.length > 0 && (
        <div className="notice">
          {data.periodErrors.map((e) => (
            <p key={e}>{e}</p>
          ))}
        </div>
      )}
      {modal === "card" && (
        <CardForm card={card} onClose={() => setModal(null)} />
      )}{" "}
      {modal === "benefit" && (
        <BenefitForm
          card={card}
          previous={previous}
          onClose={() => setModal(null)}
        />
      )}
    </>
  );
}

export function ReviewScreen() {
  const { data } = useApp(),
    today = localDate();
  const periods = data.periods
    .filter(
      (p) =>
        activePeriod(
          p,
          data.benefits.find((b) => b.id === p.benefit_id),
        ) &&
        p.enabled &&
        p.card_status === "active" &&
        p.eligibility_status !== "ineligible" &&
        (status(p) === "candidate" ||
          status(p) === "needs_review" ||
          ((knownAvailable(p) ?? 0) > 0 &&
            p.period_end_exclusive <= shiftDays(today, 15))),
    )
    .sort(sortReview);
  const unverified = data.cards.filter((c) => !c.identity_verified_at);
  return (
    <>
      <PageHeading
        eyebrow="A LITTLE ATTENTION GOES A LONG WAY"
        title="Your review queue."
        description="Ordered by expiration, then known value. You make the final call."
      />
      {periods.length ? (
        periods.map((p) => (
          <div key={p.id}>
            <p className="queue-reason">{reviewReason(p)}</p>
            <PeriodPanel period={p} initialOpen />
          </div>
        ))
      ) : (
        <Empty title="No benefit reviews waiting.">
          {data.benefits.length
            ? "Verified opportunities and candidate evidence will show up here."
            : "Add verified benefit rules to begin. Missing data is never treated as an unused balance."}
        </Empty>
      )}
      {unverified.length > 0 && (
        <section>
          <div className="section-heading">
            <h2>Confirm your starting details</h2>
            <span className="count">{unverified.length}</span>
          </div>
          <div className="setup-list">
            {unverified.map((c) => (
              <Link href={`/cards/${c.id}`} key={c.id}>
                <span className="metric-icon">
                  <WalletCards size={18} />
                </span>
                <div>
                  <strong>
                    {c.display_name} · {cardEnding(c.last4)}
                  </strong>
                  <span>
                    {c.product_name
                      ? "Card identity not yet confirmed"
                      : "Card product needs identification"}
                  </span>
                </div>
                <ArrowUpRight size={18} />
              </Link>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

const HISTORY_VIEWS = [
  ["periods", "Periods"],
  ["evidence", "Evidence ledger"],
  ["audit", "Change log"],
] as const;

export function HistoryScreen() {
  const { data } = useApp(),
    [card, setCard] = useState("all"),
    [month, setMonth] = useState("all"),
    [view, setView] = useState<(typeof HISTORY_VIEWS)[number][0]>("periods");
  const periods = data.periods.filter(
    (p) =>
      (card === "all" || p.card_id === card) &&
      (month === "all" || p.period_start.slice(0, 7) === month),
  );
  return (
    <>
      <PageHeading
        eyebrow="NOTHING LOST AT RESET"
        title="The whole story."
        description="Past periods, original evidence, and every correction—kept together."
      />
      <div className="segmented" role="group" aria-label="History view">
        {HISTORY_VIEWS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={view === key}
            onClick={() => setView(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="filter-row">
        <select
          aria-label="History card"
          value={card}
          onChange={(e) => setCard(e.target.value)}
        >
          <option value="all">All cards</option>
          {data.cards.map((c) => (
            <option key={c.id} value={c.id}>
              {c.display_name} · {cardEnding(c.last4)}
            </option>
          ))}
        </select>
        <select
          aria-label="Period starts in"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        >
          <option value="all">All starting months</option>
          {Array.from(
            new Set(data.periods.map((p) => p.period_start.slice(0, 7))),
          ).map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
      </div>
      {view === "periods" ? (
        periods.length ? (
          periods.map((p) => <PeriodPanel key={p.id} period={p} />)
        ) : (
          <Empty title="History grows with you.">
            Every new period keeps the old one intact. Your records will appear
            here as you use Perkkeep.
          </Empty>
        )
      ) : view === "evidence" ? (
        <div className="ledger">
          {data.evidence
            .filter((e) => periods.some((p) => p.id === e.benefit_period_id))
            .map((e) => (
              <article key={e.id}>
                <div className="ledger-dot" />
                <div>
                  <span className="eyebrow">
                    {new Date(e.recorded_at).toLocaleString()} ·{" "}
                    {e.recorded_by === "user"
                      ? "User-reviewed"
                      : e.recorded_by === "inference"
                        ? "Inferred"
                        : "Imported"}
                  </span>
                  <h3>
                    {e.merchant ?? e.source_type.replaceAll("_", " ")}{" "}
                    <span className={`badge ${e.confidence}`}>
                      {e.confidence}
                    </span>
                  </h3>
                  <p>
                    {
                      data.periods.find((p) => p.id === e.benefit_period_id)
                        ?.benefit_name
                    }{" "}
                    ·{" "}
                    {e.amount_cents === null
                      ? `${e.units ?? "Unknown"} units`
                      : money(e.amount_cents)}
                  </p>
                  <p>{e.notes}</p>
                  {e.supersedes_evidence_id && (
                    <small>Correction linked to earlier evidence.</small>
                  )}
                  {data.evidence.some(
                    (x) => x.supersedes_evidence_id === e.id,
                  ) && <small>Superseded · preserved for audit.</small>}
                </div>
              </article>
            ))}
          {data.evidence.length === 0 && (
            <Empty title="No evidence recorded yet.">
              Confirmations and corrections will appear in this ledger.
            </Empty>
          )}
        </div>
      ) : (
        <div className="ledger">
          {data.audit
            .filter(
              (a) =>
                (card === "all" ||
                  a.entity_id === card ||
                  data.benefits.some(
                    (b) => b.id === a.entity_id && b.card_id === card,
                  ) ||
                  data.periods.some(
                    (p) => p.id === a.entity_id && p.card_id === card,
                  ) ||
                  data.evidence.some(
                    (e) => e.id === a.entity_id && e.card_id === card,
                  )) &&
                (month === "all" || a.occurred_at.slice(0, 7) === month),
            )
            .map((a) => {
              const before = a.old_record as Record<string, unknown> | null,
                after = a.new_record as Record<string, unknown> | null;
              return (
                <article key={a.id}>
                  <div className="ledger-dot" />
                  <div>
                    <span className="eyebrow">
                      {new Date(a.occurred_at).toLocaleString()}
                    </span>
                    <h3>
                      {a.action === "INSERT" ? "Added" : "Updated"}{" "}
                      {a.entity_table.replaceAll("_", " ")}
                    </h3>
                    {after?.name ? <p>{String(after.name)}</p> : null}
                    {after?.notes !== before?.notes && (
                      <p>
                        Note: {String(before?.notes || "(empty)")} →{" "}
                        {String(after?.notes || "(empty)")}
                      </p>
                    )}
                    <small>
                      Owner-authenticated change · {a.entity_id.slice(0, 8)}
                    </small>
                  </div>
                </article>
              );
            })}
        </div>
      )}
    </>
  );
}

export function SettingsScreen() {
  const { db, data, notice, session } = useApp(),
    [coverage, setCoverage] = useState(false),
    [error, setError] = useState("");
  async function signout() {
    const { error } = await db.auth.signOut();
    if (error) setError(error.message);
    else notice("Signed out.");
  }
  return (
    <>
      <PageHeading
        eyebrow="SETTINGS"
        title="Keep it personal."
        description="Your account, how your ledger gets its data, and this app on your devices."
      />
      <section className="settings-section" aria-labelledby="settings-account">
        <h2 id="settings-account">Account</h2>
        <p>Who is signed in to this private workspace.</p>
        <div className="settings-group">
          <div className="settings-row">
            <span className="avatar" aria-hidden="true">
              {session.user.email?.slice(0, 1).toUpperCase()}
            </span>
            <div className="settings-row-text">
              <strong>{session.user.email}</strong>
              <p>Personal workspace · records are visible only to you.</p>
            </div>
            <button className="secondary" onClick={() => void signout()}>
              <LogOut size={16} /> Sign out
            </button>
          </div>
        </div>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
      </section>
      <section className="settings-section" aria-labelledby="settings-data">
        <h2 id="settings-data">Data &amp; reconciliation</h2>
        <p>Where your records come from and how coverage is checked.</p>
        <div className="settings-group">
          <div className="settings-row">
            <span className="metric-icon">
              <Database size={18} />
            </span>
            <div className="settings-row-text">
              <strong>Data source</strong>
              <p>
                Perkkeep reads your private Supabase ledger. Bank transactions
                are not fetched by this app.
              </p>
            </div>
            <span className="badge confirmed">Private ledger</span>
          </div>
          <div className="settings-row">
            <span className="metric-icon amber">
              <ShieldCheck size={18} />
            </span>
            <div className="settings-row-text">
              <strong>Automatic reconciliation</strong>
              <p>
                ChatGPT Finances access and scheduled reconciliation have not
                been verified. Coverage is recorded manually.
              </p>
            </div>
            <span className="badge needs_review">Manual only</span>
          </div>
          <div className="settings-row">
            <span className="metric-icon">
              <ClipboardCheck size={18} />
            </span>
            <div className="settings-row-text">
              <strong>Manual reconciliation</strong>
              <p>
                Record which periods you checked and through what date. Refresh
                reloads saved records; it does not check your bank.
              </p>
            </div>
            <button
              className="primary"
              disabled={!data.periods.length}
              onClick={() => setCoverage(true)}
            >
              Record a manual reconciliation
            </button>
          </div>
        </div>
        <div className="settings-subheading">
          <h3>Reconciliation log</h3>
          <span className="count">{data.runs.length}</span>
        </div>
        {data.runs.length ? (
          <div className="settings-group sync-log">
            {data.runs.map((r) => (
              <div key={r.id}>
                <div>
                  <strong>{r.trigger.replaceAll("_", " ")} check</strong>
                  <span>
                    {new Date(r.started_at).toLocaleString()} ·{" "}
                    {r.periods_checked} periods checked
                  </span>
                  {r.error_summary && (
                    <p className="form-error">{r.error_summary}</p>
                  )}
                  {typeof r.coverage_summary_json === "object" &&
                    r.coverage_summary_json &&
                    !Array.isArray(r.coverage_summary_json) && (
                      <p>
                        {String(
                          r.coverage_summary_json.description ??
                            "Coverage details retained with the run.",
                        )}
                      </p>
                    )}
                </div>
                <span
                  className={`badge ${r.status === "success" ? "success" : "failed"}`}
                >
                  {r.status}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <Empty title="No checks on record yet.">
            Your first reconciliation will record its coverage, outcome, and
            time here—including partial or failed checks.
          </Empty>
        )}
      </section>
      <section className="settings-section" aria-labelledby="settings-app">
        <h2 id="settings-app">App</h2>
        <p>Using Perkkeep on your phone and away from a connection.</p>
        <div className="settings-group">
          <div className="settings-row" id="install">
            <span className="metric-icon">
              <Smartphone size={18} />
            </span>
            <div className="settings-row-text">
              <strong>Add to Home Screen</strong>
              <ol>
                <li>
                  Open the deployed HTTPS address in Safari on your iPhone.
                </li>
                <li>Tap Share, then Add to Home Screen.</li>
                <li>Name it Perkkeep and tap Add.</li>
              </ol>
              <p className="hint">Localhost is for testing on this computer.</p>
            </div>
          </div>
          <div className="settings-row">
            <span className="metric-icon">
              <WifiOff size={18} />
            </span>
            <div className="settings-row-text">
              <strong>Offline behavior</strong>
              <p>
                Offline mode shows a reconnect page. Financial records are not
                stored in the service-worker cache.
              </p>
            </div>
          </div>
        </div>
      </section>
      {coverage && (
        <CoverageForm
          periods={data.periods}
          onClose={() => setCoverage(false)}
        />
      )}
    </>
  );
}
