"use client";
import {
  useId,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import { Check, ChevronRight, ExternalLink } from "lucide-react";
import type { Benefit, Card, Evidence, Period } from "@/lib/types";
import { run } from "@/lib/api";
import type { OperationInput } from "@/server/ledger";
import {
  isUnits,
  liveEvidence,
  progress,
  type Alert,
  type Progress,
} from "@/lib/alerts";
import {
  amountText,
  endsLabel,
  enrollmentUnknown,
  figures,
  lastDay,
  membershipStatus,
  membershipThrough,
  ROW_STATUS_LABELS,
  rowStatus,
  shortDate,
  type RowStatus,
} from "@/lib/benefit-status";
import {
  accountFreshness,
  CADENCES,
  dateLabel,
  localDate,
  money,
  parseCents,
  shiftDays,
} from "@/lib/domain";
import { faceFor } from "@/lib/card-faces";
import { useApp } from "./provider";
import {
  AllowanceForm,
  BenefitForm,
  EvidenceForm,
  NoteForm,
  manualReference,
} from "./forms";

const errorText = (e: unknown) =>
  e instanceof Error ? e.message : "Could not save.";
function integer(value: string) {
  if (!/^\d+$/.test(value) || Number(value) > 2147483647)
    throw new Error("Enter a whole number of units.");
  return Number(value);
}

// The web layout is master-detail at 900px and wider (rule 13); narrower, rows expand in place.
const WIDE = "(min-width: 900px)";
export function useWide() {
  return useSyncExternalStore(
    (notify) => {
      const m = window.matchMedia(WIDE);
      m.addEventListener("change", notify);
      return () => m.removeEventListener("change", notify);
    },
    () => window.matchMedia(WIDE).matches,
    () => false,
  );
}

// A thin bar of confirmed (solid) and possible (hatched) use against the allowance, with a tick
// at today.
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

export function CardChip({ card }: { card?: Card }) {
  if (!card) return null;
  return (
    <span
      className="card-chip"
      aria-hidden="true"
      style={{ "--chip": faceFor(card).placeholder[0] } as CSSProperties}
    />
  );
}

export type Selection = { kind: "period" | "membership"; id: string } | null;
export type ListSection = {
  key: string;
  title: string;
  summary?: ReactNode;
  rows: Period[];
  // Rows that collapse into one line at the end of the section ("Done this period (n)").
  folds?: { key: string; label: string; rows: Period[] }[];
};

// The benefits list shared by Home and the card page: one line per benefit, collapsed by default,
// and one selected benefit at a time. On a phone the selected row expands in place; at 900px and
// wider its detail opens in the right pane instead.
export function BenefitList({
  sections,
  memberships = [],
  showCard = false,
  alerts = [],
  ruleActions,
  empty,
}: {
  sections: ListSection[];
  memberships?: Benefit[];
  showCard?: boolean;
  alerts?: Alert[];
  ruleActions?: (b: Benefit) => ReactNode;
  empty?: ReactNode;
}) {
  const { data } = useApp(),
    wide = useWide(),
    [selected, setSelected] = useState<Selection>(null);
  const toggle = (s: NonNullable<Selection>) =>
    setSelected((cur) => (cur?.id === s.id ? null : s));
  const period =
    selected?.kind === "period"
      ? sections
          .flatMap((s) => [
            ...s.rows,
            ...(s.folds ?? []).flatMap((f) => f.rows),
          ])
          .find((p) => p.id === selected.id)
      : undefined;
  const membership =
    selected?.kind === "membership"
      ? memberships.find((b) => b.id === selected.id)
      : undefined;
  const detail = (p?: Period, m?: Benefit) =>
    p ? (
      <BenefitDetail
        period={p}
        benefit={data.benefits.find((b) => b.id === p.benefit_id)}
        termsAlert={alerts.find(
          (a) => a.kind === "terms_changed" && a.benefitId === p.benefit_id,
        )}
        ruleActions={ruleActions}
        wide={wide}
      />
    ) : m ? (
      <MembershipDetail benefit={m} ruleActions={ruleActions} wide={wide} />
    ) : null;
  const line = (p: Period) => (
    <BenefitLine
      key={p.id}
      period={p}
      card={data.cards.find((c) => c.id === p.card_id)}
      showCard={showCard}
      open={selected?.id === p.id}
      onToggle={() => toggle({ kind: "period", id: p.id })}
    >
      {!wide && selected?.id === p.id && detail(p)}
    </BenefitLine>
  );
  const list = (
    <div className="benefit-list-rows">
      {sections.length === 0 && memberships.length === 0 && empty}
      {sections.map((s) => (
        <section key={s.key} className="benefit-section" aria-label={s.title}>
          <header className="benefit-section-heading">
            <h2>
              {s.title} <span className="count">{s.rows.length}</span>
            </h2>
            {s.summary && (
              <span className="benefit-section-summary">{s.summary}</span>
            )}
          </header>
          <ul className="benefit-lines">
            {s.rows.map(line)}
            {(s.folds ?? [])
              .filter((f) => f.rows.length)
              .map((f) => (
                <Fold key={f.key} label={`${f.label} (${f.rows.length})`}>
                  {f.rows.map(line)}
                </Fold>
              ))}
          </ul>
        </section>
      ))}
      {memberships.length > 0 && (
        <section
          className="benefit-section"
          aria-label="Memberships and status"
        >
          <header className="benefit-section-heading">
            <h2>
              Memberships and status{" "}
              <span className="count">{memberships.length}</span>
            </h2>
            <span className="benefit-section-summary">
              nothing to spend down
            </span>
          </header>
          <ul className="benefit-lines">
            <Fold label={memberships.map((b) => shortName(b.name)).join(", ")}>
              {memberships.map((b) => (
                <MembershipLine
                  key={b.id}
                  benefit={b}
                  open={selected?.id === b.id}
                  onToggle={() => toggle({ kind: "membership", id: b.id })}
                >
                  {!wide && selected?.id === b.id && detail(undefined, b)}
                </MembershipLine>
              ))}
            </Fold>
          </ul>
        </section>
      )}
    </div>
  );
  if (!wide) return <div className="benefit-list">{list}</div>;
  return (
    <div className="benefit-list split">
      {list}
      <aside className="detail-pane" aria-label="Selected benefit">
        {detail(period, membership) ?? (
          <p className="detail-placeholder">
            Select a benefit to see its dates, evidence and what you can do with
            it.
          </p>
        )}
      </aside>
    </div>
  );
}

// Product names carry their issuer framing ("Complimentary …", "($75,000 spend tier)"); the
// collapsed memberships line lists them short.
function shortName(name: string) {
  return name
    .replace(/^Complimentary\s+/i, "")
    .replace(/\s*\(.*\)\s*$/, "")
    .replace(/\s+(membership|subscriptions?)$/i, "")
    .replace(/^./, (c) => c.toUpperCase());
}

function Fold({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false),
    id = useId();
  return (
    <li className="benefit-fold">
      <button
        type="button"
        className="benefit-fold-button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        <span>{label}</span>
        <ChevronRight size={16} aria-hidden="true" />
      </button>
      {open && (
        <ul className="benefit-lines" id={id}>
          {children}
        </ul>
      )}
    </li>
  );
}

function BenefitLine({
  period,
  card,
  showCard,
  open,
  onToggle,
  children,
}: {
  period: Period;
  card?: Card;
  showCard: boolean;
  open: boolean;
  onToggle: () => void;
  children?: ReactNode;
}) {
  const now = new Date(),
    s = rowStatus(period, now),
    pr = progress(period, now),
    today = localDate(now, period.issuer_timezone),
    ends = endsLabel(lastDay(period), today),
    id = useId();
  const quiet = s === "used" || s === "not_enrolled";
  return (
    <li className={`benefit-line ${s}${open ? " open" : ""}`}>
      <button
        type="button"
        className="benefit-line-button"
        aria-expanded={open}
        aria-controls={children ? id : undefined}
        onClick={onToggle}
      >
        {showCard && <CardChip card={card} />}
        <span className="benefit-line-name">
          {period.benefit_name}
          {showCard && (
            <span className="benefit-line-card"> · {period.card_name}</span>
          )}
        </span>
        {s === "review" && <span className="badge review">Review</span>}
        <span className="benefit-line-amount">
          {s === "used" && <span className="benefit-line-status">Used · </span>}
          {amountText(period, s)}
          {s === "unknown" && <span className="sr-only"> (unknown)</span>}
        </span>
        {!quiet && (
          <span className="benefit-line-ends">
            {ends === "today" ? "ends today" : ends}
          </span>
        )}
      </button>
      {!quiet && pr.allowance !== null && (
        <ProgressBar
          pr={pr}
          label={`${ROW_STATUS_LABELS[s]}: ${amountText(period, s)}, ends ${ends}`}
        />
      )}
      {children && (
        <div className="benefit-line-detail" id={id}>
          {children}
        </div>
      )}
    </li>
  );
}

function MembershipLine({
  benefit,
  open,
  onToggle,
  children,
}: {
  benefit: Benefit;
  open: boolean;
  onToggle: () => void;
  children?: ReactNode;
}) {
  const { data } = useApp(),
    card = data.cards.find((c) => c.id === benefit.card_id),
    today = localDate(new Date(), card?.issuer_timezone),
    s = membershipStatus(benefit, today),
    through = membershipThrough(benefit),
    id = useId();
  return (
    <li className={`benefit-line membership ${s}${open ? " open" : ""}`}>
      <button
        type="button"
        className="benefit-line-button"
        aria-expanded={open}
        aria-controls={children ? id : undefined}
        onClick={onToggle}
      >
        <span className="benefit-line-name">{benefit.name}</span>
        <span className="benefit-line-amount">{ROW_STATUS_LABELS[s]}</span>
        {s === "active" && through && (
          <span className="benefit-line-ends">
            through {shortDate(through, true)}
          </span>
        )}
      </button>
      {children && (
        <div className="benefit-line-detail" id={id}>
          {children}
        </div>
      )}
    </li>
  );
}

function useAct() {
  const { refresh, notice } = useApp(),
    [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  async function act(label: string, fn: () => Promise<unknown>, done: string) {
    setBusy(label);
    setError("");
    try {
      await fn();
      await refresh();
      notice(done);
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      setBusy("");
    }
  }
  return { busy, error, setError, act };
}

function EvidenceList({
  period,
  evidence,
  onCorrect,
}: {
  period: Period;
  evidence: Evidence[];
  onCorrect?: (e: Evidence) => void;
}) {
  const units = isUnits(period),
    amount = (e: Evidence) =>
      units
        ? `${e.units ?? 0} ${String((period.rule_snapshot as Record<string, unknown>)?.unit_label ?? "units")}`
        : money(e.amount_cents ?? 0);
  if (!evidence.length)
    return (
      <p className="benefit-detail-muted">
        Evidence: none this period. Missing evidence does not mean unused.
      </p>
    );
  return (
    <div className="benefit-evidence">
      <span className="eyebrow">Evidence</span>
      <ul>
        {evidence.map((e) => (
          <li key={e.id}>
            <span>
              {e.merchant ?? e.source_type.replaceAll("_", " ")} ·{" "}
              {shortDate(e.transaction_date)}
            </span>
            <span className="num">{amount(e)}</span>
            {e.confidence === "candidate" ? (
              <Link href="/review" className="waiting-link">
                Waiting on you ›
              </Link>
            ) : (
              <span className="benefit-detail-muted">
                {e.confidence === "confirmed"
                  ? e.recorded_by === "user"
                    ? "entered by you"
                    : "from your statement"
                  : e.confidence}
              </span>
            )}
            {onCorrect && e.confidence === "confirmed" && (
              <button
                type="button"
                className="text-button"
                onClick={() => onCorrect(e)}
              >
                Correct
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// What a selected allowance row holds (rule 5): its dates and terms, its evidence, the Mark used
// form when something is left, and the enrollment toggle. A Used or Not enrolled row asks for
// nothing (rule 12): it shows its evidence and one way back.
export function BenefitDetail({
  period,
  benefit,
  termsAlert,
  ruleActions,
  wide,
}: {
  period: Period;
  benefit?: Benefit;
  termsAlert?: Alert;
  ruleActions?: (b: Benefit) => ReactNode;
  wide: boolean;
}) {
  const { data, offline } = useApp(),
    { busy, error, setError, act } = useAct(),
    [modal, setModal] = useState<
      "evidence" | "allowance" | "note" | "terms" | null
    >(null),
    [correction, setCorrection] = useState<Evidence | undefined>();
  const now = new Date(),
    s: RowStatus = rowStatus(period, now),
    f = figures(period),
    units = isUnits(period),
    unitLabel = String(
      (period.rule_snapshot as Record<string, unknown>)?.unit_label ?? "units",
    ),
    today = localDate(now, period.issuer_timezone),
    snap = period.rule_snapshot as Record<string, unknown>,
    live = liveEvidence(
      data.evidence.filter((e) => e.benefit_period_id === period.id),
    ).filter((e) => e.confidence !== "rejected"),
    amount = (n: number | null) =>
      n === null ? "Unknown" : units ? `${n} ${unitLabel}` : money(n),
    card = data.cards.find((c) => c.id === period.card_id),
    pr = progress(period, now);
  const enrollment = benefit?.enrollment_required
    ? benefit.enrollment_status
    : null;
  async function setEnrolled(enrolled: boolean) {
    await act(
      "enroll",
      () =>
        run("saveEnrollment", {
          card_id: period.card_id,
          answers: [{ id: period.benefit_id, enrolled }],
        }),
      enrolled
        ? "Marked enrolled. It shows up and alerts again."
        : "Marked not enrolled. It stops alerting; you can change this here.",
    );
  }
  async function markUsed(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      fd = new FormData(form),
      raw = String(fd.get("amount") ?? "").trim(),
      date = String(fd.get("date") ?? today),
      note = String(fd.get("note") ?? "").trim();
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
    } catch (err) {
      setError(errorText(err));
    }
  }
  const correct = (e?: Evidence) => {
    setCorrection(e);
    setModal("evidence");
  };
  const done = s === "used" || s === "not_enrolled";
  const needsAllowance = f.allowance === null && pr.partialWindow,
    canMark =
      !done &&
      f.allowance !== null &&
      (f.remaining ?? 0) > 0 &&
      period.eligibility_status === "eligible" &&
      !!period.identity_verified_at;
  const prefill =
    f.remaining === null
      ? ""
      : units
        ? String(f.remaining)
        : (f.remaining / 100).toFixed(2);
  const description = String(snap.description ?? benefit?.description ?? "");
  return (
    <div className={`benefit-detail${wide ? " wide" : ""}`}>
      {wide && (
        <header className="benefit-detail-heading">
          <CardChip card={card} />
          <div>
            <span className="benefit-detail-muted">
              {period.card_name} ·{" "}
              {CADENCES[period.cadence as keyof typeof CADENCES] ??
                period.cadence}
            </span>
            <h2>{period.benefit_name}</h2>
          </div>
        </header>
      )}
      {wide && !done && (
        <dl className="benefit-figures">
          <div>
            <dt>{s === "unknown" ? "Maybe left" : "Left"}</dt>
            <dd className="num">
              {f.remaining === null
                ? "Unknown"
                : `${amount(f.remaining)}${s === "unknown" ? "?" : ""}`}
            </dd>
          </div>
          <div>
            <dt>Ends</dt>
            <dd>{dateLabel(lastDay(period))}</dd>
          </div>
          <div>
            <dt>Used</dt>
            <dd className="num">
              {amount(f.confirmed)} <small>of {amount(f.allowance)}</small>
            </dd>
          </div>
        </dl>
      )}
      <p className="benefit-detail-text">
        {shortDate(period.period_start)} to {shortDate(lastDay(period))}.{" "}
        {s === "used" &&
          `${amount(f.confirmed)} of ${amount(f.allowance)} used. `}
        {description}
        {benefit?.effective_to &&
          ` Through ${dateLabel(lastDay({ period_end_exclusive: benefit.effective_to }))}.`}
      </p>
      {s === "not_enrolled" ? (
        <p className="benefit-detail-muted">
          {period.eligibility_status === "ineligible"
            ? "Marked not eligible for your card. It is left out of alerts and totals."
            : "You said you are not enrolled. It is left out of alerts and totals."}
        </p>
      ) : null}
      {!done && termsAlert && (
        <div className="notice">
          <strong>{termsAlert.title}</strong>
          <p>{termsAlert.detail}</p>
          <div className="settings-row-actions">
            {benefit && card && (
              <button
                type="button"
                className="secondary"
                disabled={!!busy || offline}
                onClick={() => setModal("terms")}
              >
                Review and save a new version
              </button>
            )}
            <button
              type="button"
              className="text-button"
              disabled={!!busy || offline}
              onClick={() =>
                void act(
                  "terms",
                  () =>
                    run("acknowledgeAlert", {
                      alert_key: termsAlert.key,
                      context: termsAlert.context,
                    }),
                  "Current terms kept. This notice returns if the rule file changes again.",
                )
              }
            >
              Keep current terms
            </button>
          </div>
        </div>
      )}
      {!done && period.eligibility_status === "unknown" && (
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
      {!done && needsAllowance && (
        <p className="benefit-detail-muted">
          This window starts inside new terms, so its allowance is unknown.{" "}
          <button
            type="button"
            className="text-button"
            disabled={offline}
            onClick={() => setModal("allowance")}
          >
            Set the allowance
          </button>
        </p>
      )}
      <EvidenceList
        period={period}
        evidence={live}
        onCorrect={done ? undefined : (e) => correct(e)}
      />
      {s === "used" && (
        <button
          type="button"
          className="text-button"
          disabled={offline}
          onClick={() =>
            correct(live.find((e) => e.confidence === "confirmed"))
          }
        >
          Correct this
        </button>
      )}
      {canMark && (
        <form className="mark-used" onSubmit={markUsed}>
          <label>
            <span>{units ? `Used (${unitLabel})` : "Amount used"}</span>
            <input
              name="amount"
              inputMode="decimal"
              defaultValue={prefill}
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
          <label className="mark-used-note">
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
        </form>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {s === "not_enrolled" && period.eligibility_status !== "ineligible" ? (
        <button
          type="button"
          className="text-button"
          disabled={!!busy || offline}
          onClick={() => void setEnrolled(true)}
        >
          I am enrolled after all
        </button>
      ) : !done ? (
        <div className="benefit-detail-footer">
          {enrollment && (
            <span>
              Enrolled:{" "}
              {enrollment === "active"
                ? "yes"
                : enrollmentUnknown(benefit!)
                  ? "not answered"
                  : "no"}
            </span>
          )}
          {enrollment && (
            <button
              type="button"
              className="text-button"
              disabled={!!busy || offline}
              onClick={() => void setEnrolled(false)}
            >
              Not enrolled, hide this
            </button>
          )}
          <button
            type="button"
            className="text-button"
            disabled={offline}
            onClick={() => correct(undefined)}
          >
            Confirm redemption
          </button>
          <button
            type="button"
            className="text-button"
            disabled={offline}
            onClick={() => setModal("note")}
          >
            Add note
          </button>
          {typeof snap.issuer_source_url === "string" && (
            <a href={snap.issuer_source_url} target="_blank" rel="noreferrer">
              Issuer terms <ExternalLink size={12} />
            </a>
          )}
          {benefit && ruleActions?.(benefit)}
        </div>
      ) : null}
      {period.notes && <p className="benefit-detail-muted">{period.notes}</p>}
      {modal === "evidence" && (
        <EvidenceForm
          period={period}
          correction={correction}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "allowance" && (
        <AllowanceForm period={period} onClose={() => setModal(null)} />
      )}
      {modal === "note" && (
        <NoteForm period={period} onClose={() => setModal(null)} />
      )}
      {modal === "terms" && benefit && card && (
        <BenefitForm
          card={card}
          previous={benefit}
          templateId={String(termsAlert?.context.rule_id ?? "")}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

// A membership's detail (rule 11): its terms, Active or Not activated, and only two inputs: the
// activation date and the enrollment toggle.
function MembershipDetail({
  benefit,
  ruleActions,
  wide,
}: {
  benefit: Benefit;
  ruleActions?: (b: Benefit) => ReactNode;
  wide: boolean;
}) {
  const { data, offline } = useApp(),
    { busy, error, act } = useAct(),
    card = data.cards.find((c) => c.id === benefit.card_id),
    today = localDate(new Date(), card?.issuer_timezone),
    s = membershipStatus(benefit, today),
    through = membershipThrough(benefit);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const on = String(new FormData(e.currentTarget).get("activated_on") ?? "");
    await act(
      "activation",
      () => run("setActivation", { id: benefit.id, activated_on: on }),
      "Activation date saved.",
    );
  }
  const notEnrolledYet =
    benefit.enrollment_required && benefit.enrollment_status === "inactive";
  return (
    <div className={`benefit-detail${wide ? " wide" : ""}`}>
      {wide && (
        <header className="benefit-detail-heading">
          <CardChip card={card} />
          <div>
            <span className="benefit-detail-muted">
              {card?.display_name} · Membership
            </span>
            <h2>{benefit.name}</h2>
          </div>
        </header>
      )}
      <p className="benefit-detail-text">
        <strong>{ROW_STATUS_LABELS[s]}</strong>
        {benefit.activated_on && !notEnrolledYet
          ? ` since ${dateLabel(benefit.activated_on)}${benefit.activation_assumed ? " (assumed)" : ""}`
          : ""}
        {through ? `, through ${dateLabel(through)}` : ""}.{" "}
        {benefit.description}
      </p>
      {!notEnrolledYet && (
        <form className="mark-used" onSubmit={save}>
          <label>
            <span>Activated on</span>
            <input
              name="activated_on"
              type="date"
              required
              defaultValue={benefit.activated_on ?? today}
              max={today}
              aria-label={`Activation date for ${benefit.name}`}
            />
          </label>
          <button
            className="small-button"
            disabled={busy === "activation" || offline}
          >
            Save date
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="benefit-detail-footer">
        {benefit.enrollment_required && (
          <button
            type="button"
            className="text-button"
            disabled={!!busy || offline}
            onClick={() =>
              void act(
                "enroll",
                () =>
                  run("saveEnrollment", {
                    card_id: benefit.card_id,
                    answers: [{ id: benefit.id, enrolled: notEnrolledYet }],
                  }),
                notEnrolledYet
                  ? "Marked enrolled."
                  : "Marked not activated. It stops alerting.",
              )
            }
          >
            {notEnrolledYet
              ? "I am enrolled after all"
              : "Not enrolled, hide this"}
          </button>
        )}
        {benefit.issuer_source_url && (
          <a href={benefit.issuer_source_url} target="_blank" rel="noreferrer">
            Issuer terms <ExternalLink size={12} />
          </a>
        )}
        {ruleActions?.(benefit)}
      </div>
    </div>
  );
}

// The card's one-time enrollment question (rule 4): every benefit whose enrollment is unknown,
// checked by default; Save answers all of them, so the panel does not come back.
export function EnrollmentChecklist({
  card,
  benefits,
}: {
  card: Card;
  benefits: Benefit[];
}) {
  const { offline } = useApp(),
    { busy, error, act } = useAct();
  if (!benefits.length) return null;
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await act(
      "save",
      () =>
        run("saveEnrollment", {
          card_id: card.id,
          answers: benefits.map((b) => ({ id: b.id, enrolled: f.has(b.id) })),
        }),
      "Enrollment saved. Unchecked benefits stop alerting.",
    );
  }
  return (
    <section
      className="enrollment-checklist"
      id="enrollment"
      aria-labelledby="enrollment-title"
    >
      <h2 id="enrollment-title">Which of these are you enrolled in?</h2>
      <p>
        {benefits.length}{" "}
        {benefits.length === 1 ? "benefit needs" : "benefits need"} activation.
        Unchecked ones stop showing up.
      </p>
      <form onSubmit={save}>
        <div className="enrollment-options">
          {benefits.map((b) => (
            <label key={b.id}>
              <input type="checkbox" name={b.id} defaultChecked />
              {shortName(b.name)}
            </label>
          ))}
        </div>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <button className="primary" disabled={!!busy || offline}>
          Save
        </button>
      </form>
    </section>
  );
}

// The card's one caveat line (rule 3), from the synced accounts linked to it.
export function SyncCaveat({ card }: { card: Card }) {
  const { data } = useApp(),
    linked = data.accounts.filter(
      (a) => a.card_id === card.id && a.mapping_status === "confirmed",
    ),
    today = localDate(new Date(), card.issuer_timezone),
    through = linked
      .map((a) => a.synced_through)
      .filter((d): d is string => !!d)
      .sort()[0],
    stale =
      !through ||
      through < shiftDays(today, -7) ||
      linked.some((a) => accountFreshness(a) !== "current");
  if (!linked.length)
    return (
      <p className="sync-caveat stale">
        No synced account covers this card, so use will not show.{" "}
        <Link href="/settings">Link one in Settings</Link>
      </p>
    );
  return (
    <p className={`sync-caveat${stale ? " stale" : ""}`}>
      {through
        ? `Transactions synced through ${shortDate(through)}`
        : "Transactions not synced yet"}
      {stale && (
        <>
          ; newer use will not show.{" "}
          <Link href="/settings">Check Settings</Link>
        </>
      )}
    </p>
  );
}
