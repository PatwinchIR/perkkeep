"use client";
import { useState } from "react";
import { ExternalLink, Check, Plus, FileText, ChevronDown } from "lucide-react";
import type { Period, Evidence } from "@/lib/types";
import {
  money,
  cardEnding,
  periodLabel,
  reviewReason,
  status,
  coverageFresh,
  dateLabel,
} from "@/lib/domain";
import { useApp } from "./provider";
import { run } from "@/lib/api";
import { Badge } from "./ui";
import { EvidenceForm, RejectForm, NoteForm } from "./forms";
export function PeriodPanel({
  period,
  initialOpen = false,
}: {
  period: Period;
  initialOpen?: boolean;
}) {
  const { data, refresh, notice, offline } = useApp(),
    [open, setOpen] = useState(initialOpen),
    [modal, setModal] = useState<"evidence" | "note" | "reject" | null>(null),
    [selected, setSelected] = useState<Evidence | undefined>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const evidence = data.evidence.filter(
      (e) => e.benefit_period_id === period.id,
    ),
    superseded = new Set(evidence.map((e) => e.supersedes_evidence_id)),
    live = evidence.filter((e) => !superseded.has(e.id));
  const snap = period.rule_snapshot as Record<string, unknown>,
    isUnits = snap.nominal_units != null,
    unitLabel = String(snap.unit_label ?? "units");
  const amount = (n: number | null) =>
    isUnits ? (n === null ? "Not established" : `${n} ${unitLabel}`) : money(n);
  async function enroll() {
    setBusy(true);
    setError("");
    try {
      await run("markEnrolled", { id: period.benefit_id });
      await refresh();
      notice("Enrollment marked active based on your confirmation.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    }
    setBusy(false);
  }
  return (
    <article className="period-panel">
      <div className="period-heading">
        <div>
          <span className="overline">
            {period.card_name} · {cardEnding(period.last4)}
          </span>
          <h3>{period.benefit_name}</h3>
          <p className="period-dates">{periodLabel(period)}</p>
        </div>
        <Badge period={period} />
      </div>
      <div className="period-amounts">
        <div>
          <span>Allowance</span>
          <strong>
            {amount(isUnits ? period.allowance_units : period.allowance_cents)}
          </strong>
        </div>
        <div>
          <span>Confirmed used</span>
          <strong>
            {amount(isUnits ? period.confirmed_units : period.confirmed_cents)}
          </strong>
        </div>
        <div>
          <span>Potentially qualifying</span>
          <strong>
            {amount(isUnits ? period.candidate_units : period.candidate_cents)}
          </strong>
        </div>
      </div>
      {status(period) === "needs_review" || status(period) === "candidate" ? (
        <p className="review-hint">{reviewReason(period)}</p>
      ) : null}
      {!coverageFresh(period) && (
        <p className="coverage-note">
          {period.coverage_status === "unavailable"
            ? "Coverage unavailable"
            : period.coverage_status === "partial"
              ? "Partial transaction coverage"
              : "Coverage needs a fresh check"}{" "}
          · Remaining value may be incomplete.
        </p>
      )}
      <div className="period-actions">
        <button
          className="small-button"
          disabled={offline}
          onClick={() => {
            setSelected(undefined);
            setModal("evidence");
          }}
        >
          <Check size={15} /> Confirm redemption
        </button>
        <button
          className="text-button"
          disabled={offline}
          onClick={() => setModal("note")}
        >
          <Plus size={14} /> Add note
        </button>
        <button
          className="text-button evidence-toggle"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          Evidence ({live.length}) <ChevronDown size={14} />
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {open && (
        <div className="period-evidence">
          <p>{String(snap.description ?? "")}</p>
          <div className="term-details">
            {period.enrollment_required && (
              <span>Enrollment: {period.enrollment_status}</span>
            )}
            <span>Eligibility: {period.eligibility_status}</span>
            {typeof snap.issuer_source_url === "string" && (
              <a href={snap.issuer_source_url} target="_blank" rel="noreferrer">
                Issuer terms <ExternalLink size={12} />
              </a>
            )}
          </div>
          {period.enrollment_required &&
            period.enrollment_status !== "active" && (
              <button
                className="small-button"
                disabled={busy || offline}
                onClick={() => void enroll()}
              >
                I verified enrollment is active
              </button>
            )}
          {period.notes && (
            <div className="saved-note">
              <FileText size={15} />
              <p>{period.notes}</p>
            </div>
          )}
          {live.length === 0 ? (
            <p className="hint">
              No evidence recorded for this period. Missing evidence does not
              establish that a benefit is unused.
            </p>
          ) : (
            live.map((e) => (
              <div className="evidence-row" key={e.id}>
                <div>
                  <strong>
                    {e.merchant ?? e.source_type.replaceAll("_", " ")}
                  </strong>
                  <span>
                    {dateLabel(e.transaction_date)} ·{" "}
                    {e.source_type.replaceAll("_", " ")} ·{" "}
                    {e.recorded_by === "user"
                      ? "User-reviewed"
                      : e.recorded_by === "inference"
                        ? "Inferred"
                        : "Imported"}
                  </span>
                  {e.notes && <p>{e.notes}</p>}
                  <span className={`badge ${e.confidence}`}>
                    {e.confidence}
                  </span>
                </div>
                <div className="evidence-right">
                  <strong>{amount(isUnits ? e.units : e.amount_cents)}</strong>
                  <button
                    className="text-button"
                    disabled={offline}
                    onClick={() => {
                      setSelected(e);
                      setModal("evidence");
                    }}
                  >
                    {e.confidence === "candidate"
                      ? "Review candidate"
                      : "Correct"}
                  </button>
                  {e.confidence === "candidate" && (
                    <button
                      className="text-button reject"
                      disabled={offline}
                      onClick={() => {
                        setSelected(e);
                        setModal("reject");
                      }}
                    >
                      Reject candidate
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
          {superseded.size > 0 && (
            <p className="hint">
              Earlier versions of evidence remain in History.
            </p>
          )}
        </div>
      )}
      {modal === "evidence" && (
        <EvidenceForm
          period={period}
          correction={selected}
          onClose={() => setModal(null)}
        />
      )}{" "}
      {modal === "note" && (
        <NoteForm period={period} onClose={() => setModal(null)} />
      )}{" "}
      {modal === "reject" && selected && (
        <RejectForm
          period={period}
          evidence={selected}
          onClose={() => setModal(null)}
        />
      )}
    </article>
  );
}
