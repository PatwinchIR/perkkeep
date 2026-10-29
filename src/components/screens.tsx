"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  BellRing,
  ClipboardCheck,
  Clock3,
  Plus,
  ShieldCheck,
  Smartphone,
  LogOut,
  UserRound,
  WifiOff,
} from "lucide-react";
import { useActive, useApp } from "./provider";
import { run, runSource } from "@/lib/api";
import { RULE_FILES } from "@/lib/catalog";
import { CardTile, Dialog, Empty, PageHeading } from "./ui";
import { PeriodPanel } from "./period-panel";
import {
  BenefitList,
  CardChip,
  EnrollmentChecklist,
  SyncCaveat,
  type ListSection,
} from "./benefit-row";
import { useAlerts } from "./alerts";
import type { Alert } from "@/lib/alerts";
import {
  amountText,
  enrollmentUnknown,
  expiryGroups,
  expiryHeading,
  figures,
  groupRows,
  isMembership,
  lastDay,
  shortDate,
} from "@/lib/benefit-status";
import { reviewQueue, staleNote } from "@/lib/review";
import {
  AddCardForm,
  BenefitForm,
  CardForm,
  CoverageForm,
  manualReference,
} from "./forms";
import { SourcesPanel } from "./sources";
import { CardArtPanel } from "./card-art";
import { authClient } from "@/lib/auth-client";
import {
  activePeriod,
  cardEnding,
  CADENCES,
  localDate,
  money,
} from "@/lib/domain";
import type { Benefit, Evidence, Period } from "@/lib/types";
import type { OperationInput } from "@/server/ledger";

export function HomeScreen() {
  const { data, refresh, notice, offline } = useApp(),
    alerts = useAlerts(),
    active = useActive(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const now = new Date(),
    today = localDate(now),
    current = active.periods.filter(
      (p) =>
        activePeriod(
          p,
          data.benefits.find((b) => b.id === p.benefit_id),
        ) &&
        p.enabled &&
        p.card_status === "active",
    ),
    queue = reviewQueue(data, alerts, now);
  const sections: ListSection[] = expiryGroups(current, now).map((g) => ({
    key: g.day,
    title: expiryHeading(g.day, today),
    summary:
      g.remainingCents > 0
        ? `${money(g.remainingCents)}${g.known ? "" : "?"} ${g.cards > 1 ? `across ${g.cards} cards` : "left"}`
        : undefined,
    rows: g.rows,
  }));
  const enrolling = queue.enrollment.reduce((n, e) => n + e.benefits.length, 0);
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
      <header className="home-heading">
        <h1>Use before it expires</h1>
        <span>
          {new Intl.DateTimeFormat("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
            timeZone: "America/New_York",
          }).format(now)}
        </span>
      </header>
      {(queue.candidates.length > 0 || enrolling > 0) && (
        <section className="needs-you" aria-labelledby="needs-you-title">
          <div className="needs-you-heading">
            <h2 id="needs-you-title" className="eyebrow">
              Needs you
            </h2>
            <Link href="/review">Open review</Link>
          </div>
          {queue.candidates.length > 0 && (
            <Link href="/review" className="needs-you-item">
              <span>
                {queue.candidates.length}{" "}
                {queue.candidates.length === 1
                  ? "purchase might be a benefit"
                  : "purchases might be benefits"}
              </span>
              <span className="needs-you-action">Confirm</span>
            </Link>
          )}
          {enrolling > 0 && (
            <Link
              href={
                queue.enrollment.length === 1
                  ? `/cards/${queue.enrollment[0].card.id}#enrollment`
                  : "/review#enrollment"
              }
              className="needs-you-item"
            >
              <span>
                {queue.enrollment.length === 1
                  ? `Which ${queue.enrollment[0].card.display_name} perks are you enrolled in?`
                  : `Enrollment for ${queue.enrollment.length} cards`}
              </span>
              <span className="needs-you-action">{enrolling} ›</span>
            </Link>
          )}
        </section>
      )}
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
      ) : (
        <BenefitList
          sections={sections}
          alerts={alerts}
          showCard
          empty={
            <div className="quiet-note">
              <span className="metric-icon">
                <Clock3 size={21} />
              </span>
              <div>
                <strong>
                  {current.length
                    ? "Nothing with value left is waiting on you."
                    : "Your next opportunity starts with a verified benefit."}
                </strong>
                <p>
                  {current.length ? (
                    <>
                      Used, not enrolled and membership benefits are on each
                      card. <Link href="/cards">Open Cards</Link>
                    </>
                  ) : (
                    "Open a card to confirm its details and add its researched benefits or your own from current issuer terms."
                  )}
                </p>
              </div>
            </div>
          }
        />
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
    </>
  );
}

export function CardsScreen() {
  const { data, offline } = useApp(),
    active = useActive(),
    [adding, setAdding] = useState(false);
  return (
    <>
      <PageHeading
        eyebrow="YOUR WALLET"
        title="Every card has a story."
        description="Confirm the details, then keep track of what comes with them."
        action={
          <button
            className="primary"
            disabled={offline}
            onClick={() => setAdding(true)}
          >
            <Plus size={16} /> Add a card
          </button>
        }
      />
      {adding && <AddCardForm onClose={() => setAdding(false)} />}
      {active.cards.length ? (
        <div className="cards-grid">
          {active.cards.map((c) => (
            <CardTile
              key={c.id}
              card={c}
              periods={active.periods.filter(
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
            data.cards.length ? undefined : (
              <Link className="primary" href="/">
                Set up your cards
              </Link>
            )
          }
        >
          Start with your known cards from the overview, or add a card.
        </Empty>
      )}
    </>
  );
}

export function CardScreen({ id }: { id: string }) {
  const { data, refresh, notice, offline } = useApp(),
    alerts = useAlerts(),
    [modal, setModal] = useState<"card" | "benefit" | "remove" | null>(null),
    [previous, setPrevious] = useState<Benefit | undefined>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const card = data.cards.find((c) => c.id === id);
  if (!card)
    return (
      <Empty
        title="Card not found."
        action={<Link href="/cards">Back to cards</Link>}
      >
        This card is unavailable to your account.
      </Empty>
    );
  const today = localDate(new Date(), card.issuer_timezone),
    benefits = data.benefits.filter((b) => b.card_id === id),
    current = (b: Benefit) =>
      b.enabled &&
      b.effective_from <= today &&
      (!b.effective_to || b.effective_to > today),
    periods = data.periods.filter(
      (p) =>
        p.card_id === id &&
        activePeriod(
          p,
          benefits.find((b) => b.id === p.benefit_id),
        ),
    ),
    memberships = benefits
      .filter((b) => isMembership(b) && current(b))
      .sort((a, b) => a.name.localeCompare(b.name)),
    unanswered = benefits.filter((b) => current(b) && enrollmentUnknown(b));
  const sections: ListSection[] = groupRows(periods).map((g) => ({
    key: g.cadence,
    title: g.label,
    summary: [
      g.allowanceCents > 0 &&
        `${money(g.confirmedCents)} of ${money(g.allowanceCents)} used`,
      g.endsOn && `next reset ${shortDate(g.endsOn)}`,
    ]
      .filter(Boolean)
      .join(" · "),
    rows: g.rows,
    folds: [
      { key: "done", label: "Done this period", rows: g.done },
      { key: "not-enrolled", label: "Not enrolled", rows: g.notEnrolled },
    ],
  }));
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
  async function setRemoved(remove: boolean) {
    setBusy(true);
    setError("");
    try {
      await run(remove ? "archiveCard" : "restoreCard", { id });
      await refresh();
      setModal(null);
      notice(
        remove
          ? "Card removed. Its history stays in History; restore it from Settings."
          : "Card restored with its full history.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to update the card.");
    } finally {
      setBusy(false);
    }
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
    (b) =>
      !(isMembership(b) && current(b)) &&
      !periods.some((p) => p.benefit_id === b.id),
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
  const count = periods.length + memberships.length;
  return (
    <>
      <Link className="back-link" href="/cards">
        ← Cards
      </Link>
      <header className="card-heading">
        <CardChip card={card} />
        <div>
          <span className="eyebrow">
            {card.issuer} · {cardEnding(card.last4)}
          </span>
          <h1>{card.display_name}</h1>
          <p>
            {card.identity_verified_at
              ? `${count} ${count === 1 ? "benefit" : "benefits"}`
              : (card.product_name ??
                "This card’s product still needs to be identified.")}
            {card.cardmember_anchor_date &&
              ` · year resets ${shortDate(card.cardmember_anchor_date)}`}
          </p>
        </div>
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
      </header>
      {card.archived_at && (
        <div className="notice">
          <strong>This card was removed.</strong>
          <p>
            It is hidden from your overview and totals and opens no new periods.
            Its history is kept.
          </p>
          <button
            className="secondary"
            disabled={busy || offline}
            onClick={() => void setRemoved(false)}
          >
            Restore card
          </button>
        </div>
      )}
      {!card.identity_verified_at && !card.archived_at && (
        <div className="notice">
          <strong>First, make sure this is the right card.</strong>
          <p>
            Confirm its current product with your issuer before enabling any
            product-specific benefits. We haven’t assigned any entitlements.
          </p>
        </div>
      )}
      {card.identity_verified_at &&
        !card.archived_at &&
        benefits.length > 0 && <SyncCaveat card={card} />}
      {!card.archived_at && (
        <EnrollmentChecklist card={card} benefits={unanswered} />
      )}
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
        <BenefitList
          sections={sections}
          memberships={memberships}
          alerts={alerts.filter((a) => a.cardId === id)}
          ruleActions={ruleActions}
        />
      )}
      {others.length > 0 && (
        <details className="history-tool">
          <summary>Paused and earlier rules ({others.length})</summary>
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
        </details>
      )}
      <div className="card-tools">
        <button
          className="secondary"
          disabled={
            !card.identity_verified_at ||
            card.status !== "active" ||
            !!card.archived_at ||
            offline
          }
          onClick={() => {
            setPrevious(undefined);
            setModal("benefit");
          }}
        >
          <Plus size={16} /> Add benefit
        </button>
      </div>
      {benefits.some((b) => b.enabled && !isMembership(b)) && (
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
                  .filter((b) => b.enabled && !isMembership(b))
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
      <CardArtPanel card={card} />
      {!card.archived_at && (
        <div className="settings-signout">
          <button
            className="text-button"
            disabled={busy || offline}
            onClick={() => setModal("remove")}
          >
            Remove this card
          </button>
        </div>
      )}
      {modal === "remove" && (
        <Dialog title="Remove this card?" onClose={() => setModal(null)}>
          <p className="dialog-intro">
            {card.display_name} will leave your overview, card list and totals,
            and no new benefit periods will open. Nothing is deleted: its
            periods, evidence, account links and audit history stay, and you can
            restore it from Settings.
          </p>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <button
            className="primary"
            disabled={busy || offline}
            onClick={() => void setRemoved(true)}
          >
            {busy ? "Removing…" : "Remove card"}
          </button>
        </Dialog>
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
    queue = reviewQueue(data, alerts);
  return (
    <>
      <PageHeading
        eyebrow="REVIEW"
        title="Review"
        description="Only what PerkKeep cannot decide alone. Empty is the goal."
      />
      {queue.count === 0 && queue.stale.length === 0 && (
        <Empty title="Nothing to review.">
          Purchases that may be a benefit, benefits ending with no evidence, and
          enrollment questions will show up here.
        </Empty>
      )}
      {queue.candidates.length > 0 && (
        <section className="review-section" aria-labelledby="review-candidates">
          <h2 id="review-candidates">Was this purchase a benefit?</h2>
          {queue.candidates.map((c) => (
            <CandidateItem key={c.evidence.id} {...c} />
          ))}
        </section>
      )}
      {(queue.endingSoon.length > 0 || queue.stale.length > 0) && (
        <section className="review-section" aria-labelledby="review-ending">
          <h2 id="review-ending">Ending soon with no evidence</h2>
          {queue.endingSoon.length > 0 && (
            <ul className="review-list">
              {queue.endingSoon.map((e) => (
                <EndingItem key={e.alert.key} {...e} />
              ))}
            </ul>
          )}
          {queue.stale.map((s) => (
            <p className="review-note" key={s.card.id}>
              {staleNote(s)}{" "}
              <Link
                href={s.accounts.length ? "/settings" : `/cards/${s.card.id}`}
              >
                {s.accounts.length
                  ? `Fix the ${s.card.display_name} connection`
                  : "Open the card"}
              </Link>
            </p>
          ))}
        </section>
      )}
      {queue.enrollment.length > 0 && (
        <section
          className="review-section"
          id="enrollment"
          aria-labelledby="review-enrollment"
        >
          <h2 id="review-enrollment">Enrollment</h2>
          {queue.enrollment.map((e) => (
            <Link
              key={e.card.id}
              href={`/cards/${e.card.id}#enrollment`}
              className="review-link"
            >
              <span>
                {e.card.display_name}: {e.benefits.length}{" "}
                {e.benefits.length === 1 ? "perk needs" : "perks need"} an
                answer
              </span>
              <span className="review-link-action">Answer ›</span>
            </Link>
          ))}
        </section>
      )}
    </>
  );
}

// A purchase the matcher proposed (rule 8): the transaction, the benefit it may be, and Yes or
// Not this. Yes appends a confirmation that supersedes the candidate, capped at what is left;
// Not this appends a rejection. The candidate itself stays in History.
function CandidateItem({
  evidence,
  period,
}: {
  evidence: Evidence;
  period: Period;
}) {
  const { refresh, notice, offline } = useApp(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const f = figures(period),
    units = f.allowance !== null && period.allowance_units !== null,
    spent = (units ? evidence.units : evidence.amount_cents) ?? 0,
    count =
      f.remaining && f.remaining > 0 ? Math.min(spent, f.remaining) : spent,
    show = (n: number | null) => (units ? `${n ?? 0} units` : money(n ?? 0));
  async function answer(yes: boolean) {
    setBusy(true);
    setError("");
    try {
      const id = crypto.randomUUID();
      await run(
        "recordEvidence",
        yes
          ? {
              id,
              benefit_period_id: period.id,
              source_type: "manual",
              source_reference_hash: await manualReference(id),
              transaction_date: evidence.transaction_date,
              merchant: evidence.merchant,
              amount_cents: units ? null : count,
              units: units ? count : null,
              eligibility_result: "eligible",
              confirmation_result: "Owner confirmed in Review",
              confidence: "confirmed",
              notes:
                "Owner confirmed in Review that this purchase used the benefit.",
              supersedes_evidence_id: evidence.id,
            }
          : {
              id,
              benefit_period_id: period.id,
              source_type:
                evidence.source_type as OperationInput<"recordEvidence">["source_type"],
              transaction_date: evidence.transaction_date,
              amount_cents: evidence.amount_cents,
              units: evidence.units,
              confidence: "rejected",
              eligibility_result: "ineligible",
              notes: "Owner answered in Review: not this benefit.",
              supersedes_evidence_id: evidence.id,
            },
      );
      await refresh();
      notice(
        yes
          ? `${show(count)} counted toward ${period.benefit_name}.`
          : "Marked as not this benefit. The purchase stays in History.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
      setBusy(false);
    }
  }
  return (
    <article className="review-item">
      <div className="review-item-heading">
        <h3>
          {evidence.merchant ?? evidence.source_type.replaceAll("_", " ")}
        </h3>
        <span className="num">{show(spent)}</span>
      </div>
      <p>
        {shortDate(evidence.transaction_date)} · {period.card_name} · matches{" "}
        <strong>{period.benefit_name}</strong>
        {f.remaining !== null && f.allowance !== null
          ? ` (${show(f.remaining)} of ${show(f.allowance)} left)`
          : ""}
      </p>
      {evidence.notes && <p>{evidence.notes}</p>}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="review-item-actions">
        <button
          className="primary"
          disabled={busy || offline}
          onClick={() => void answer(true)}
        >
          Yes, count {show(count)}
        </button>
        <button
          className="secondary"
          disabled={busy || offline}
          onClick={() => void answer(false)}
        >
          Not this
        </button>
      </div>
    </article>
  );
}

// A window ending soon with fresh coverage and nothing used: Used it records the remaining amount
// as the owner's own confirmation; Skip dismisses the alert until its facts change. A membership
// whose window closes soon has only Skip and a link to its card.
function EndingItem({
  alert,
  period,
}: {
  alert: Alert;
  period: Period | null;
}) {
  const { refresh, notice, offline } = useApp(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const f = period ? figures(period) : null,
    units = !!period && period.allowance_units !== null;
  async function act(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
      notice(done);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
      setBusy(false);
    }
  }
  async function usedIt() {
    if (!period || !f?.remaining) return;
    const id = crypto.randomUUID(),
      today = localDate(new Date(), period.issuer_timezone);
    await act(
      async () =>
        run("recordEvidence", {
          id,
          benefit_period_id: period.id,
          source_type: "manual",
          source_reference_hash: await manualReference(id),
          transaction_date: today,
          merchant: null,
          amount_cents: units ? null : f.remaining,
          units: units ? f.remaining : null,
          eligibility_result: "eligible",
          confirmation_result: "Owner entered the amount used",
          confidence: "confirmed",
          notes: "Owner marked it used in Review.",
          supersedes_evidence_id: null,
        }),
      `${period.benefit_name} recorded as used.`,
    );
  }
  return (
    <li className="review-row">
      <div>
        <span className="review-row-name">
          {period?.benefit_name ?? alert.title}
          {period && (
            <span className="benefit-line-card"> · {period.card_name}</span>
          )}
        </span>
        <span className="review-row-meta">
          {period && f
            ? `${amountText(period, "available")} · ends ${shortDate(lastDay(period))}`
            : alert.detail}
        </span>
        {error && (
          <span role="alert" className="form-error">
            {error}
          </span>
        )}
      </div>
      {period ? (
        <button
          className="secondary"
          disabled={busy || offline}
          onClick={() => void usedIt()}
        >
          Used it
        </button>
      ) : (
        <Link href={alert.href} className="secondary">
          Open card
        </Link>
      )}
      <button
        className="quiet-button"
        disabled={busy || offline}
        onClick={() =>
          void act(
            () =>
              run("acknowledgeAlert", {
                alert_key: alert.key,
                context: alert.context,
              }),
            "Skipped. It returns if anything changes.",
          )
        }
      >
        Skip
      </button>
    </li>
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
              {c.archived_at ? " (removed)" : ""}
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
  const { data, session, signOut, refresh, notice, offline } = useApp(),
    active = useActive(),
    removed = data.cards.filter((c) => c.archived_at),
    [coverage, setCoverage] = useState(false),
    [error, setError] = useState("");
  async function restore(id: string) {
    try {
      await run("restoreCard", { id });
      await refresh();
      notice("Card restored with its full history.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not restore the card.");
    }
  }
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
      {removed.length > 0 && (
        <section
          className="settings-section"
          aria-labelledby="settings-removed"
        >
          <h2 id="settings-removed">Removed cards</h2>
          <p>
            Hidden from your overview and totals. Their periods, evidence and
            audit history stay in History.
          </p>
          <div className="settings-group">
            {removed.map((c) => (
              <div className="settings-row" key={c.id}>
                <div className="settings-row-text">
                  <h3>{c.display_name}</h3>
                  <p>
                    {c.issuer} · {cardEnding(c.last4)}
                  </p>
                </div>
                <button
                  className="secondary"
                  disabled={offline}
                  onClick={() => void restore(c.id)}
                >
                  Restore
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
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
              disabled={!active.periods.length}
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
          periods={active.periods}
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
