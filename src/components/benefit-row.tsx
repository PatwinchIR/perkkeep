"use client";
import { useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { Check, ChevronDown } from "lucide-react";
import type { Benefit, Period } from "@/lib/types";
import { run } from "@/lib/api";
import type { OperationInput } from "@/server/ledger";
import {
  formatAmount,
  groupByCadence,
  isUnits,
  progress,
  type Alert,
  type Progress,
} from "@/lib/alerts";
import {
  cardEnding,
  coverageFresh,
  dateLabel,
  localDate,
  money,
  parseCents,
  periodLabel,
  shiftDays,
  status,
} from "@/lib/domain";
import { useApp } from "./provider";
import { Badge } from "./ui";
import { PeriodPanel } from "./period-panel";
import { AllowanceForm, EvidenceForm, manualReference } from "./forms";

const errorText = (e: unknown) =>
  e instanceof Error ? e.message : "Could not save.";
function integer(value: string) {
  if (!/^\d+$/.test(value) || Number(value) > 2147483647)
    throw new Error("Enter a whole number of units.");
  return Number(value);
}

// One compact line per benefit window: name, time left, a bar of confirmed (solid) and possible
// (hatched) use against the allowance with a tick at today, the amounts, status, and the one
// action the row needs. Details and the evidence ledger open underneath.
export function ProgressBar({ pr, label }: { pr: Progress; label: string }) {
  if (pr.allowance === null)
    return (
      <div className="progress unknown" role="img" aria-label={label}>
        <span
          className="progress-time"
          style={{ left: `${pr.elapsedFraction * 100}%` }}
        />
      </div>
    );
  const confirmed = (pr.confirmedFraction ?? 0) * 100,
    candidate = (pr.candidateFraction ?? 0) * 100;
  return (
    <div
      className={`progress${pr.trusted ? "" : " untrusted"}`}
      role="img"
      aria-label={label}
    >
      <span className="progress-confirmed" style={{ width: `${confirmed}%` }} />
      <span
        className="progress-candidate"
        style={{ left: `${confirmed}%`, width: `${candidate}%` }}
      />
      <span
        className="progress-time"
        style={{ left: `${pr.elapsedFraction * 100}%` }}
      />
    </div>
  );
}

export function BenefitRow({
  period,
  benefit,
  showCard = false,
  initialOpen = false,
  termsAlert,
  actions,
}: {
  period: Period;
  benefit?: Benefit;
  showCard?: boolean;
  initialOpen?: boolean;
  termsAlert?: Alert;
  actions?: ReactNode;
}) {
  const { refresh, notice, offline } = useApp(),
    [open, setOpen] = useState(initialOpen),
    [modal, setModal] = useState<"evidence" | "allowance" | null>(null),
    [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  const now = new Date(),
    pr = progress(period, now),
    s = status(period, now),
    units = isUnits(period),
    today = localDate(now, period.issuer_timezone),
    expired = s === "expired",
    amount = (n: number | null) => formatAmount(period, n);
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
  async function quick(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      f = new FormData(form),
      raw = String(f.get("amount") ?? "").trim(),
      date = String(f.get("date") ?? today),
      note = String(f.get("note") ?? "").trim();
    try {
      const n = units ? integer(raw) : parseCents(raw);
      if (n <= 0) throw new Error("Enter the amount you used.");
      const id = crypto.randomUUID();
      const record: OperationInput<"recordEvidence"> = {
        id,
        benefit_period_id: period.id,
        source_type: "manual",
        source_reference_hash: await manualReference(id),
        transaction_date: date,
        merchant: null,
        amount_cents: units ? null : n,
        units: units ? n : null,
        eligibility_result: "eligible",
        confirmation_result: "Owner entered the amount used",
        confidence: "confirmed",
        notes: note || "Entered by the owner on the benefit row.",
        supersedes_evidence_id: null,
      };
      await act(
        "quick",
        () => run("recordEvidence", record),
        `${amount(n)} recorded as used. Earlier records stay in history.`,
      );
      form.reset();
    } catch (err) {
      setError(errorText(err));
    }
  }
  const needsIdentity = !period.identity_verified_at,
    needsEligibility = period.eligibility_status !== "eligible",
    needsEnrollment =
      period.enrollment_required && period.enrollment_status !== "active",
    needsAllowance = pr.allowance === null && pr.partialWindow,
    hasCandidate = pr.candidate > 0,
    fresh = coverageFresh(period, now),
    quickable =
      !expired &&
      !needsIdentity &&
      !needsEligibility &&
      !needsEnrollment &&
      period.enabled;
  const daysText = expired
    ? "ended"
    : pr.daysLeft === 0
      ? "ends today"
      : `${pr.daysLeft} ${pr.daysLeft === 1 ? "day" : "days"} left`;
  const barLabel =
    pr.allowance === null
      ? `Allowance not established; ${daysText}`
      : `${amount(pr.confirmed)} of ${amount(pr.allowance)} confirmed used${pr.candidate ? `, ${amount(pr.candidate)} possible` : ""}; ${daysText}`;
  return (
    <article
      className={`benefit-row${open ? " open" : ""}${expired ? " expired" : ""}`}
    >
      <div className="benefit-row-main">
        <div className="benefit-row-title">
          <h3>{period.benefit_name}</h3>
          <span className="benefit-row-meta">
            {showCard && (
              <Link
                href={`/cards/${period.card_id}`}
                className="benefit-row-card"
              >
                {period.card_name} · {cardEnding(period.last4)}
              </Link>
            )}
            <span>
              {periodLabel(period)} · {daysText}
            </span>
          </span>
        </div>
        <div className="benefit-row-progress">
          <ProgressBar pr={pr} label={barLabel} />
          <span className="benefit-row-amounts" aria-hidden="true">
            {pr.allowance === null ? (
              <em>Allowance not established</em>
            ) : (
              <>
                <strong>{amount(pr.confirmed)}</strong> of{" "}
                {amount(pr.allowance)}
                {pr.candidate > 0 && (
                  <span className="benefit-row-candidate">
                    {" "}
                    · {amount(pr.candidate)} possible
                  </span>
                )}
                {pr.remaining !== null && pr.remaining > 0 && !expired && (
                  <span className="benefit-row-remaining">
                    {" "}
                    · {amount(pr.remaining)} {fresh ? "left" : "unconfirmed"}
                  </span>
                )}
              </>
            )}
          </span>
        </div>
        <div className="benefit-row-side">
          <Badge period={period} />
          <button
            type="button"
            className="icon-button row-toggle"
            aria-expanded={open}
            aria-label={`${open ? "Hide" : "Show"} details for ${period.benefit_name}`}
            onClick={() => setOpen(!open)}
          >
            <ChevronDown size={18} />
          </button>
        </div>
      </div>
      {(needsIdentity ||
        needsEligibility ||
        needsEnrollment ||
        needsAllowance ||
        hasCandidate ||
        termsAlert ||
        period.negative_balance) && (
        <div className="benefit-row-hint">
          {needsIdentity && (
            <span>
              Confirm this card’s identity first.{" "}
              <Link href={`/cards/${period.card_id}`} className="text-button">
                Open card
              </Link>
            </span>
          )}
          {needsEligibility && (
            <span>
              {period.eligibility_status === "ineligible"
                ? "Marked not eligible for your card."
                : "Eligibility unconfirmed."}{" "}
              {period.eligibility_status !== "ineligible" && (
                <button
                  type="button"
                  className="text-button"
                  disabled={!!busy || offline}
                  onClick={() =>
                    void act(
                      "eligible",
                      () => run("markEligible", { id: period.benefit_id }),
                      "Eligibility confirmed based on your check.",
                    )
                  }
                >
                  <Check size={14} /> I verified my card is eligible
                </button>
              )}
            </span>
          )}
          {needsEnrollment && (
            <span>
              Enrollment unconfirmed.{" "}
              <button
                type="button"
                className="text-button"
                disabled={!!busy || offline}
                onClick={() =>
                  void act(
                    "enroll",
                    () => run("markEnrolled", { id: period.benefit_id }),
                    "Enrollment marked active based on your confirmation.",
                  )
                }
              >
                <Check size={14} /> I verified enrollment is active
              </button>
            </span>
          )}
          {needsAllowance && (
            <span>
              This window starts inside new terms, so its allowance is unknown.{" "}
              <button
                type="button"
                className="text-button"
                disabled={offline}
                onClick={() => setModal("allowance")}
              >
                Set the allowance
              </button>
            </span>
          )}
          {hasCandidate && (
            <span>
              A purchase may qualify.{" "}
              <button
                type="button"
                className="text-button"
                onClick={() => setOpen(true)}
              >
                Review it
              </button>
            </span>
          )}
          {termsAlert && (
            <span>
              {termsAlert.title}.{" "}
              <button
                type="button"
                className="text-button"
                onClick={() => setOpen(true)}
              >
                See what changed
              </button>
            </span>
          )}
          {period.negative_balance && (
            <span>
              Reversals exceed recorded confirmations. Review the evidence.
            </span>
          )}
        </div>
      )}
      {!fresh && !expired && (
        <p className="benefit-row-coverage">
          {period.coverage_status === "unavailable"
            ? "Coverage unavailable"
            : period.coverage_status === "partial"
              ? "Partial transaction coverage"
              : "Coverage needs a fresh check"}{" "}
          · remaining value may be incomplete.
        </p>
      )}
      {quickable && (
        <form className="benefit-row-quick" onSubmit={quick}>
          <label>
            <span>{units ? `Used (${pr.unitLabel})` : "Amount used"}</span>
            <input
              name="amount"
              inputMode="decimal"
              placeholder={units ? "1" : "0.00"}
              aria-label={`${units ? "Units" : "Amount"} used for ${period.benefit_name}`}
            />
          </label>
          <label>
            <span>On</span>
            <input
              name="date"
              type="date"
              defaultValue={today}
              min={period.period_start}
              max={today}
              aria-label={`Date used for ${period.benefit_name}`}
            />
          </label>
          <label className="benefit-row-note">
            <span>Note</span>
            <input
              name="note"
              maxLength={200}
              placeholder="Optional"
              aria-label={`Note for ${period.benefit_name}`}
            />
          </label>
          <button
            className="small-button"
            disabled={busy === "quick" || offline}
          >
            <Check size={15} /> Mark used
          </button>
          <button
            type="button"
            className="text-button"
            disabled={offline}
            onClick={() => setModal("evidence")}
          >
            Confirm redemption
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {open && (
        <PeriodPanel
          period={period}
          benefit={benefit}
          embedded
          initialOpen
          termsAlert={termsAlert}
          actions={actions}
        />
      )}
      {modal === "evidence" && (
        <EvidenceForm period={period} onClose={() => setModal(null)} />
      )}
      {modal === "allowance" && (
        <AllowanceForm period={period} onClose={() => setModal(null)} />
      )}
    </article>
  );
}

// Current periods grouped by reset timeframe, soonest-ending first, with totals per group.
export function BenefitGroups({
  periods,
  benefits = [],
  alerts = [],
  showCard = false,
  initialOpen = false,
  actions,
}: {
  periods: Period[];
  benefits?: Benefit[];
  alerts?: Alert[];
  showCard?: boolean;
  initialOpen?: boolean;
  actions?: (benefit: Benefit) => ReactNode;
}) {
  const groups = groupByCadence(periods);
  return (
    <>
      {groups.map((g) => (
        <section key={g.cadence} className="cadence-group">
          <header className="cadence-group-heading">
            <h2>
              {g.label} <span className="count">{g.periods.length}</span>
            </h2>
            <span className="cadence-group-totals">
              {g.allowanceCents > 0 && (
                <>
                  <strong>{money(g.confirmedCents)}</strong> of{" "}
                  {money(g.allowanceCents)} used
                  {g.unknownAllowance ? " (some allowances unknown)" : ""}{" "}
                  ·{" "}
                </>
              )}
              {g.endsOn && `next reset ${dateLabel(shiftDays(g.endsOn, -1))}`}
            </span>
          </header>
          {g.periods.map((p) => {
            const b = benefits.find((x) => x.id === p.benefit_id);
            return (
              <BenefitRow
                key={p.id}
                period={p}
                benefit={b}
                showCard={showCard}
                initialOpen={initialOpen}
                termsAlert={alerts.find(
                  (a) =>
                    a.kind === "terms_changed" && a.benefitId === p.benefit_id,
                )}
                actions={b && actions ? actions(b) : undefined}
              />
            );
          })}
        </section>
      ))}
    </>
  );
}
