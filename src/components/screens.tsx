"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  BellRing,
  CheckCheck,
  ClipboardCheck,
  Clock3,
  Plus,
  Search,
  ShieldCheck,
  Smartphone,
  LogOut,
  UserRound,
  WifiOff,
} from "lucide-react";
import { useApp } from "./provider";
import { run, runSource } from "@/lib/api";
import { RULE_FILES } from "@/lib/catalog";
import { CardTile, Empty, PageHeading } from "./ui";
import { PeriodPanel } from "./period-panel";
import { BenefitGroups } from "./benefit-row";
import { AlertStack, useAlerts } from "./alerts";
import { activity, attention } from "@/lib/alerts";
import { BenefitForm, CardForm, CoverageForm } from "./forms";
import { SourcesPanel } from "./sources";
import { CardArtPanel } from "./card-art";
import { authClient } from "@/lib/auth-client";
import {
  activePeriod,
  cardEnding,
  CADENCES,
  knownAvailable,
  localDate,
  money,
  sortReview,
  status,
} from "@/lib/domain";
import type { Benefit } from "@/lib/types";

export function Dashboard() {
  const { data, refresh, notice, offline } = useApp(),
    alerts = useAlerts(),
    [issuer, setIssuer] = useState("all"),
    [cardFilter, setCardFilter] = useState("all"),
    [cadence, setCadence] = useState("all"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const current = data.periods.filter(
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
  const needs = attention(alerts),
    recent = activity(alerts);
  const cards = data.cards.filter(
    (c) =>
      (issuer === "all" || c.issuer === issuer) &&
      (cardFilter === "all" || c.id === cardFilter) &&
      (cadence === "all" || filtered.some((p) => p.card_id === c.id)),
  );
  async function setup() {
    setBusy(true);
    try {
      await run("initializeCards", {});
      await refresh();
      notice(
        "Your cards are added. Confirm their current identities before adding benefits.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add cards.");
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
      <div className="section-heading">
        <div>
          <span className="eyebrow">NEEDS ATTENTION</span>
          <h2>
            Before anything else <span className="count">{needs.length}</span>
          </h2>
        </div>
        <Link href="/review">
          Review queue <ArrowUpRight size={15} />
        </Link>
      </div>
      <AlertStack
        alerts={needs}
        limit={5}
        moreHref="/review"
        empty="Nothing needs your attention right now."
      />
      <div className="section-heading lower">
        <div>
          <span className="eyebrow">BY RESET WINDOW</span>
          <h2>
            Your benefits <span className="count">{filtered.length}</span>
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
      {filtered.length > 0 ? (
        <BenefitGroups
          periods={filtered}
          benefits={data.benefits}
          alerts={alerts}
          showCard
        />
      ) : data.cards.length > 0 ? (
        <div className="quiet-note">
          <span className="metric-icon">
            <Clock3 size={21} />
          </span>
          <div>
            <strong>
              {current.length
                ? "No benefits in this view."
                : "Your next opportunity starts with a verified benefit."}
            </strong>
            <p>
              {current.length
                ? "Try a different issuer, card or timeframe."
                : "Open a card to confirm its details and add its researched benefits or your own from current issuer terms."}
            </p>
          </div>
        </div>
      ) : null}
      <div className="section-heading lower">
        <div>
          <span className="eyebrow">THE EVERYDAY COLLECTION</span>
          <h2>
            Your cards <span className="count">{data.cards.length}</span>
          </h2>
        </div>
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
          <span className="eyebrow">LAST 30 DAYS</span>
          <h2>
            Recent use <span className="count">{recent.length}</span>
          </h2>
        </div>
        <Link href="/history">
          Full history <ArrowUpRight size={15} />
        </Link>
      </div>
      <AlertStack
        alerts={recent}
        limit={6}
        moreHref="/history"
        empty="No confirmed use recorded in the last 30 days. Confirmed statement credits and amounts you enter will appear here."
      />
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
  const { data, refresh, notice, offline } = useApp(),
    alerts = useAlerts(),
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
  const researched = RULE_FILES.find(
      (f) => f.researched && f.catalog_key === card.catalog_key,
    ),
    missing = (researched?.rules ?? []).filter(
      (r) =>
        !benefits.some(
          (b) =>
            (b.eligibility_rules_json as { catalog_rule_id?: string })
              ?.catalog_rule_id === r.id,
        ),
    );
  async function addResearched() {
    setBusy(true);
    setError("");
    try {
      const r = (await run("addResearchedBenefits", { card_id: id })) as {
        added: string[];
        skipped: string[];
      };
      await runSource("runMatchers", {});
      await refresh();
      notice(
        `${r.added.length} researched ${r.added.length === 1 ? "benefit" : "benefits"} added and matched against your transactions.` +
          (r.skipped.length
            ? ` Not added (needs your dates or has ended): ${r.skipped.join(", ")}.`
            : ""),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add benefits.");
    }
    setBusy(false);
  }
  async function historical(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      await run("ensurePeriod", {
        benefit_id: String(f.get("benefit")),
        on: String(f.get("day")),
      });
      await refresh();
      notice("Period preserved. Open History to see earlier periods.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    }
    setBusy(false);
  }
  async function pause(b: Benefit) {
    setBusy(true);
    try {
      await run("setBenefitEnabled", { id: b.id, enabled: !b.enabled });
      await refresh();
      notice(b.enabled ? "Rule paused; history retained." : "Rule enabled.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    }
    setBusy(false);
  }
  async function recheck(b: Benefit) {
    setBusy(true);
    try {
      await run("markReverified", { id: b.id });
      await refresh();
      notice("Terms marked as re-checked today.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    }
    setBusy(false);
  }
  const others = benefits.filter(
    (b) => !periods.some((p) => p.benefit_id === b.id),
  );
  const ruleActions = (b: Benefit) => (
    <>
      <span>
        Terms verified{" "}
        {b.verified_at
          ? new Date(b.verified_at).toLocaleDateString()
          : "not yet"}
        {b.last_reverified_at
          ? ` · re-checked ${new Date(b.last_reverified_at).toLocaleDateString()}`
          : ""}
      </span>
      {(!b.effective_to || b.effective_to > localDate()) && (
        <>
          <button
            className="text-button"
            disabled={offline || busy}
            onClick={() => void recheck(b)}
          >
            Terms unchanged today
          </button>
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
    </>
  );
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
      <CardArtPanel card={card} />
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
        <h2>
          Benefits <span className="count">{periods.length}</span>
        </h2>
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
      {card.identity_verified_at &&
        card.status === "active" &&
        missing.length > 0 && (
          <div className="notice">
            <strong>
              {missing.length} researched{" "}
              {missing.length === 1 ? "benefit" : "benefits"} for this card
            </strong>
            <p>
              Read on {card.issuer}&rsquo;s own pages:{" "}
              {missing.map((r) => r.name).join(", ")}. Enrollment stays unknown
              until you confirm it.
            </p>
            <button
              className="secondary"
              disabled={busy || offline}
              onClick={() => void addResearched()}
            >
              {busy ? "Adding…" : "Add researched benefits"}
            </button>
          </div>
        )}
      {benefits.length === 0 ? (
        <Empty title="A clean start for this card.">
          Add a benefit using current issuer terms. Nothing is assumed from the
          card’s name alone.
        </Empty>
      ) : (
        <>
          <BenefitGroups
            periods={periods}
            benefits={benefits}
            alerts={alerts.filter((a) => a.cardId === id)}
            actions={ruleActions}
          />
          {others.length > 0 && (
            <section className="cadence-group">
              <header className="cadence-group-heading">
                <h2>
                  Rules without a current period{" "}
                  <span className="count">{others.length}</span>
                </h2>
              </header>
              {others.map((b) => (
                <div className="rule-without-period" key={b.id}>
                  <strong>
                    {b.name} · {CADENCES[b.cadence as keyof typeof CADENCES]}
                  </strong>
                  <span>
                    {!b.enabled
                      ? "Paused"
                      : b.effective_to && b.effective_to <= localDate()
                        ? "Previous rule version"
                        : "Period not established — check reset dates and eligibility"}
                  </span>
                  <div className="rule-actions">{ruleActions(b)}</div>
                </div>
              ))}
            </section>
          )}
        </>
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
    alerts = useAlerts(),
    needs = attention(alerts);
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
        (status(p) === "candidate" || status(p) === "needs_review"),
    )
    .sort(sortReview);
  return (
    <>
      <PageHeading
        eyebrow="A LITTLE ATTENTION GOES A LONG WAY"
        title="Your review queue."
        description="Everything that needs a decision, ordered by urgency. You make the final call."
      />
      <div className="section-heading">
        <h2>
          Needs attention <span className="count">{needs.length}</span>
        </h2>
      </div>
      <AlertStack
        alerts={needs}
        empty="Nothing needs your attention right now."
      />
      <div className="section-heading lower">
        <h2>
          Benefits to review <span className="count">{periods.length}</span>
        </h2>
      </div>
      {periods.length ? (
        <BenefitGroups
          periods={periods}
          benefits={data.benefits}
          alerts={alerts}
          showCard
          initialOpen
        />
      ) : (
        <Empty title="No benefit reviews waiting.">
          {data.benefits.length
            ? "Candidate evidence and unconfirmed details will show up here."
            : "Add verified benefit rules to begin. Missing data is never treated as an unused balance."}
        </Empty>
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
  const { data, session, signOut } = useApp(),
    [coverage, setCoverage] = useState(false),
    [error, setError] = useState("");
  async function signout() {
    try {
      await signOut();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not sign out.");
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="SETTINGS"
        title="Keep it personal."
        description="Your account, connected accounts, reconciliation, and this app on your devices."
      />
      <section className="settings-section" aria-labelledby="settings-account">
        <h2 id="settings-account">Account</h2>
        <p>Who is signed in, and the name printed on your card faces.</p>
        <div className="settings-group">
          <div className="settings-row">
            <span className="avatar" aria-hidden="true">
              {session.email.slice(0, 1).toUpperCase()}
            </span>
            <div className="settings-row-text">
              <h3>{session.email}</h3>
              <p>Personal workspace · records are visible only to you.</p>
            </div>
            <button className="secondary" onClick={() => void signout()}>
              <LogOut size={16} /> Sign out
            </button>
          </div>
          <NameOnCards />
        </div>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
      </section>
      <SourcesPanel />
      <section className="settings-section" aria-labelledby="settings-recon">
        <h2 id="settings-recon">Reconciliation</h2>
        <p>How coverage is checked, and every check on record.</p>
        <div className="settings-group">
          <div className="settings-row">
            <span className="metric-icon">
              <ShieldCheck size={18} />
            </span>
            <div className="settings-row-text">
              <h3>How your data is used</h3>
              <p>
                Perkkeep reads your private ledger on the server, under your
                verified sign-in. Connected accounts sync once a day;
                transactions are evidence for review and never change a balance
                on their own.
              </p>
            </div>
          </div>
          <div className="settings-row">
            <span className="metric-icon">
              <ClipboardCheck size={18} />
            </span>
            <div className="settings-row-text">
              <h3>Manual reconciliation</h3>
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
              <h3>Add to Home Screen</h3>
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
          <AlertSettings />
          <div className="settings-row">
            <span className="metric-icon">
              <WifiOff size={18} />
            </span>
            <div className="settings-row-text">
              <h3>Offline behavior</h3>
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

// The card overlay name comes from the owner's sign-in profile, never from source code.
function NameOnCards() {
  const { session, reloadSession, notice, offline } = useApp(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  if (session.provider !== "neon") return null;
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get("name") ?? "").trim();
    setBusy(true);
    setError("");
    try {
      const { error } = await authClient().updateUser({ name });
      if (error) throw new Error(error.message ?? "Could not save your name.");
      await reloadSession();
      notice("Name on cards updated.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your name.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="settings-row">
      <span className="metric-icon">
        <UserRound size={18} />
      </span>
      <div className="settings-row-text">
        <h3>Name on your cards</h3>
        <p>Printed on card faces that show your name and last four digits.</p>
        <form className="form-row" onSubmit={save}>
          <label>
            Name
            <input
              name="name"
              required
              maxLength={60}
              defaultValue={session.name ?? ""}
              autoComplete="name"
            />
          </label>
          <button className="secondary" disabled={busy || offline}>
            Save name
          </button>
        </form>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

// Alert timing. Alerts themselves are derived from the ledger; only this preference is stored.
function AlertSettings() {
  const { data, refresh, notice, offline } = useApp(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const days = Number(new FormData(e.currentTarget).get("lead"));
    setBusy(true);
    setError("");
    try {
      await run("updateSettings", { alert_lead_days: days });
      await refresh();
      notice(
        `Ending-soon alerts now start ${days} days before a window closes.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="settings-row">
      <span className="metric-icon">
        <BellRing size={18} />
      </span>
      <div className="settings-row-text">
        <h3>Alerts</h3>
        <p>
          Alerts are worked out from your ledger every time it loads: windows
          ending soon, possible use to review, terms that changed, and use that
          was confirmed. Dismissed alerts come back if the facts change.
        </p>
        <form className="form-row" onSubmit={save}>
          <label>
            Warn this many days before a window ends
            <input
              name="lead"
              type="number"
              min={1}
              max={90}
              required
              defaultValue={data.settings.alert_lead_days}
            />
          </label>
          <button className="secondary" disabled={busy || offline}>
            Save
          </button>
        </form>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
