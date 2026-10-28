"use client";
import { useState, type FormEvent } from "react";
import type { Card, Benefit, Period, Evidence, SyncRun } from "@/lib/types";
import { run } from "@/lib/api";
import type { OperationInput } from "@/server/ledger";
import { CATALOG } from "@/lib/catalog";
import { CADENCES, localDate, parseCents, cardEnding } from "@/lib/domain";
import { useApp } from "./provider";
import { Dialog } from "./ui";
function ErrorText({ error }: { error: string }) {
  return error ? (
    <p role="alert" className="form-error">
      {error}
    </p>
  ) : null;
}
function message(e: unknown) {
  return e instanceof Error
    ? e.message
    : typeof e === "object" && e && "message" in e
      ? String(e.message)
      : "Unable to save. Please try again.";
}
function text(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}
function integer(value: string) {
  if (!/^\d+$/.test(value) || Number(value) > 2147483647)
    throw new Error("Enter a whole number of units.");
  return Number(value);
}

export function CardForm({
  card,
  onClose,
}: {
  card: Card;
  onClose: () => void;
}) {
  const { refresh, notice, offline } = useApp(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await run("updateCard", {
        id: card.id,
        display_name: text(f, "name"),
        product_name: text(f, "product") || null,
        last4: text(f, "last4") || null,
        status: text(f, "status") as "active" | "closed" | "unknown",
        cardmember_anchor_date: text(f, "anchor") || null,
        issuer_timezone: text(f, "timezone"),
      });
      await refresh();
      notice("Card details confirmed.");
      onClose();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="Confirm your card" onClose={onClose}>
      <p className="dialog-intro">
        Check the product and last four digits against your issuer account:{" "}
        {card.issuer} · {cardEnding(card.last4)}.
      </p>
      <form className="form-stack" onSubmit={submit}>
        <label>
          Display name
          <input
            name="name"
            required
            maxLength={100}
            defaultValue={card.display_name}
          />
        </label>
        <label>
          Verified product name
          <input
            name="product"
            required
            maxLength={150}
            defaultValue={card.product_name ?? ""}
          />
        </label>
        <label>
          Last four digits (optional)
          <input
            name="last4"
            inputMode="numeric"
            pattern="[0-9]{4}"
            maxLength={4}
            autoComplete="off"
            placeholder="Not provided"
            defaultValue={card.last4 ?? ""}
          />
        </label>
        <div className="form-row">
          <label>
            Card status
            <select
              name="status"
              defaultValue={card.status === "unknown" ? "active" : card.status}
            >
              <option value="active">Active</option>
              <option value="closed">Closed</option>
            </select>
          </label>
          <label>
            Cardmember anniversary
            <input
              name="anchor"
              type="date"
              defaultValue={card.cardmember_anchor_date ?? ""}
            />
          </label>
        </div>
        <label>
          Issuer’s calendar timezone
          <input
            name="timezone"
            required
            defaultValue={card.issuer_timezone}
            list="timezones"
          />
        </label>
        <datalist id="timezones">
          <option value="America/New_York" />
          <option value="America/Chicago" />
          <option value="America/Denver" />
          <option value="America/Los_Angeles" />
          <option value="Pacific/Honolulu" />
        </datalist>
        <p className="hint">
          Leave the anniversary blank if unknown. For statement-cycle benefits,
          use the exact custom dates shown by your issuer.
        </p>
        <label className="check">
          <input type="checkbox" required /> I checked this card’s identity and
          details with the issuer.
        </label>
        <ErrorText error={error} />
        <button className="primary" disabled={busy || offline}>
          {busy ? "Saving…" : "Save card details"}
        </button>
      </form>
    </Dialog>
  );
}

export function BenefitForm({
  card,
  previous,
  onClose,
}: {
  card: Card;
  previous?: Benefit;
  onClose: () => void;
}) {
  const { refresh, notice, offline } = useApp(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [template, setTemplate] = useState(""),
    [cadence, setCadence] = useState(previous?.cadence ?? "monthly"),
    [units, setUnits] = useState(
      previous?.nominal_units !== null && previous?.nominal_units !== undefined,
    ),
    [enroll, setEnroll] = useState(previous?.enrollment_required ?? false);
  const selected = CATALOG.find((x) => x.id === template),
    options = CATALOG.filter((x) => x.product === card.product_name);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const amount = text(f, "amount"),
        source = new URL(text(f, "source"));
      if (source.protocol !== "https:")
        throw new Error("Use the official issuer’s HTTPS page.");
      const start = text(f, "effective"),
        end = text(f, "effective_end");
      if (end && end <= start)
        throw new Error("The rule end must follow its start.");
      const changes = {
        card_id: card.id,
        name: text(f, "name"),
        description: text(f, "description"),
        category: text(f, "category") || "Other",
        cadence,
        nominal_amount_cents: !units && amount ? parseCents(amount) : null,
        nominal_units: units && amount ? integer(amount) : null,
        unit_label: units ? text(f, "unit_label") : null,
        reset_anchor: text(f, "anchor") || null,
        custom_end_exclusive: text(f, "custom_end") || null,
        effective_from: start,
        effective_to: end || null,
        enrollment_required: enroll,
        enrollment_status: enroll
          ? f.get("enrolled")
            ? "active"
            : "unknown"
          : "not_required",
        eligibility_status: f.get("eligible") ? "eligible" : "unknown",
        manual_verification_required: !!f.get("manual"),
        eligibility_rules_json: {
          conditions: text(f, "description"),
          source_observed_at: selected?.checkedAt ?? localDate(),
          effective_date_confirmed_by: "user",
          // Links this benefit to the reviewed rule file (data/benefits) and the version used.
          ...(selected
            ? {
                catalog_rule_id: selected.id,
                catalog_rule_version: selected.checkedAt,
                terms_verified: selected.verified,
              }
            : {}),
        },
        issuer_source_url: source.href,
        verified_at: new Date().toISOString(),
        enabled: true,
      };
      if (
        ["custom", "one_time"].includes(cadence) &&
        (!changes.custom_end_exclusive ||
          changes.custom_end_exclusive <= (changes.reset_anchor ?? start))
      )
        throw new Error(
          "Set a valid exclusive end date for this custom window.",
        );
      if (previous)
        await run("versionBenefit", {
          benefit_id: previous.id,
          effective_from: start,
          changes,
        });
      else
        await run("createBenefit", changes as OperationInput<"createBenefit">);
      await refresh();
      notice(
        previous
          ? "New rule version saved. Earlier snapshots are preserved."
          : "Benefit rule saved.",
      );
      onClose();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={previous ? "Add a new rule version" : "Add a benefit"}
      onClose={onClose}
    >
      <p className="dialog-intro">
        Use current issuer terms. Your eligibility and enrollment are separate
        from the published allowance.
      </p>
      {!previous && options.length > 0 && (
        <label className="catalog-select">
          Start from a sourced rule
          <select
            value={template}
            onChange={(e) => {
              setTemplate(e.target.value);
              const t = CATALOG.find((x) => x.id === e.target.value);
              setCadence(t?.cadence ?? "monthly");
              setEnroll(t?.enrollment ?? false);
              setUnits(false);
            }}
          >
            <option value="">Custom verified benefit</option>
            {options.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          {selected && (
            <small>
              {selected.verified
                ? `Read on the issuer's page on ${selected.checkedAt}.`
                : "Terms not verified with the issuer."}{" "}
              {selected.effectiveTo
                ? `Ends before ${selected.effectiveTo}. `
                : ""}
              <a href={selected.source} target="_blank" rel="noreferrer">
                Review issuer terms ↗
              </a>
            </small>
          )}
        </label>
      )}
      <form key={template} className="form-stack" onSubmit={submit}>
        <label>
          Benefit name
          <input
            name="name"
            required
            maxLength={150}
            defaultValue={selected?.name ?? previous?.name ?? ""}
          />
        </label>
        <label>
          Conditions and exclusions
          <textarea
            name="description"
            required
            rows={3}
            defaultValue={selected?.description ?? previous?.description ?? ""}
          />
        </label>
        <div className="form-row">
          <label>
            Reset timeframe
            <select
              value={cadence}
              onChange={(e) => setCadence(e.target.value)}
            >
              {Object.entries(CADENCES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            Category
            <input
              name="category"
              defaultValue={previous?.category ?? "Other"}
            />
          </label>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={units}
            onChange={(e) => setUnits(e.target.checked)}
          />{" "}
          Track visits, passes, or other units
        </label>
        <div className="form-row">
          <label>
            {units ? "Allowance in units" : "Allowance in dollars"}
            <input
              name="amount"
              inputMode="decimal"
              placeholder="Leave blank if unknown"
              defaultValue={
                selected?.cents != null
                  ? String(selected.cents / 100)
                  : previous
                    ? units
                      ? String(previous.nominal_units ?? "")
                      : previous.nominal_amount_cents != null
                        ? String(previous.nominal_amount_cents / 100)
                        : ""
                    : ""
              }
            />
          </label>
          {units && (
            <label>
              Unit name
              <input
                name="unit_label"
                required
                defaultValue={previous?.unit_label ?? "visits"}
              />
            </label>
          )}
        </div>
        <div className="form-row">
          <label>
            {previous ? "New terms take effect" : "Terms effective from"}
            <input
              name="effective"
              type="date"
              required
              defaultValue={localDate()}
            />
          </label>
          {!previous && (
            <label>
              Terms end (exclusive)
              <input name="effective_end" type="date" />
            </label>
          )}
        </div>
        <p className="hint">
          Enter the actual effective date. A partial month or year keeps its
          allowance unknown; Perkkeep never guesses a prorated value.
        </p>
        {["custom", "one_time", "cardmember_year"].includes(cadence) && (
          <div className="form-row">
            <label>
              {cadence === "cardmember_year"
                ? "Verified reset anchor"
                : "Window starts"}
              <input
                name="anchor"
                type="date"
                defaultValue={previous?.reset_anchor ?? ""}
              />
            </label>
            {cadence !== "cardmember_year" && (
              <label>
                Window ends (exclusive)
                <input
                  name="custom_end"
                  type="date"
                  required
                  defaultValue={previous?.custom_end_exclusive ?? ""}
                />
              </label>
            )}
          </div>
        )}
        <label>
          Official issuer source
          <input
            name="source"
            type="url"
            required
            placeholder="https://…"
            defaultValue={selected?.source ?? previous?.issuer_source_url ?? ""}
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={enroll}
            onChange={(e) => setEnroll(e.target.checked)}
          />{" "}
          Enrollment or account activation required
        </label>
        {enroll && (
          <label className="check">
            <input type="checkbox" name="enrolled" /> I verified that enrollment
            is active
          </label>
        )}
        <label className="check">
          <input type="checkbox" name="eligible" /> I verified that my card is
          eligible
        </label>
        <label className="check">
          <input
            type="checkbox"
            name="manual"
            defaultChecked={
              selected?.manual ??
              previous?.manual_verification_required ??
              false
            }
          />{" "}
          Redemption needs verification outside card statements
        </label>
        <label className="check">
          <input type="checkbox" required /> I checked the source, effective
          dates, and conditions above.
        </label>
        <ErrorText error={error} />
        <button className="primary" disabled={busy || offline}>
          {busy
            ? "Saving…"
            : previous
              ? "Save new version"
              : "Save verified rule"}
        </button>
      </form>
    </Dialog>
  );
}

export function EvidenceForm({
  period,
  correction,
  onClose,
}: {
  period: Period;
  correction?: Evidence;
  onClose: () => void;
}) {
  const { refresh, notice, offline } = useApp(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [id] = useState(() => crypto.randomUUID()),
    [source, setSource] = useState(
      correction?.confidence === "candidate"
        ? "manual"
        : (correction?.source_type ?? "manual"),
    ),
    [confidence, setConfidence] = useState(
      correction?.confidence === "candidate"
        ? "confirmed"
        : (correction?.confidence ?? "confirmed"),
    );
  const units =
    period.allowance_units !== null ||
    (typeof period.rule_snapshot === "object" &&
      period.rule_snapshot !== null &&
      !Array.isArray(period.rule_snapshot) &&
      period.rule_snapshot.nominal_units != null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const amount = units
        ? integer(text(f, "amount"))
        : parseCents(text(f, "amount"));
      const negative = ["refund", "reversal"].includes(source);
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(`manual:${id}`),
      );
      const reference = Array.from(new Uint8Array(digest))
        .map((x) => x.toString(16).padStart(2, "0"))
        .join("");
      const p_record = {
        id,
        benefit_period_id: period.id,
        source_type: source,
        source_reference_hash: reference,
        transaction_date: text(f, "date"),
        merchant: text(f, "merchant") || null,
        amount_cents: units ? null : negative ? -amount : amount,
        units: units ? (negative ? -amount : amount) : null,
        eligibility_result:
          confidence === "rejected" ? "ineligible" : "eligible",
        confirmation_result:
          confidence === "confirmed"
            ? "User checked supporting confirmation"
            : "Not issuer-confirmed",
        confidence:
          source === "purchase" && confidence === "confirmed"
            ? "candidate"
            : confidence,
        notes: text(f, "notes"),
        supersedes_evidence_id: correction?.id ?? null,
      };
      await run("recordEvidence", p_record as OperationInput<"recordEvidence">);
      await refresh();
      notice("Evidence saved. Earlier records remain in history.");
      onClose();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={correction ? "Review or correct evidence" : "Confirm redemption"}
      onClose={onClose}
    >
      <p className="dialog-intro">
        {period.benefit_name}.{" "}
        {correction
          ? "This adds a correction linked to the earlier record."
          : "Confirm only what your issuer or benefit provider has actually fulfilled."}
      </p>
      <form className="form-stack" onSubmit={submit}>
        <div className="form-row">
          <label>
            Evidence source
            <select
              value={source}
              onChange={(e) => {
                setSource(e.target.value);
                if (e.target.value === "purchase") setConfidence("candidate");
              }}
            >
              <option value="manual">My manual confirmation</option>
              <option value="statement_credit">Posted statement credit</option>
              <option value="issuer_portal">Issuer / benefit portal</option>
              <option value="email_confirmation">Confirmation email</option>
              <option value="purchase">Potentially qualifying purchase</option>
              <option value="refund">Confirmed entitlement refund</option>
              <option value="reversal">Confirmed entitlement reversal</option>
            </select>
          </label>
          <label>
            Assessment
            <select
              value={confidence}
              onChange={(e) => setConfidence(e.target.value)}
            >
              <option value="confirmed" disabled={source === "purchase"}>
                Confirmed
              </option>
              <option value="candidate">Candidate</option>
              <option value="unknown">Needs review</option>
              <option value="rejected">Rejected</option>
            </select>
          </label>
        </div>
        <div className="form-row">
          <label>
            {units ? "Number of units" : "Amount in dollars"}
            <input
              name="amount"
              inputMode="decimal"
              required
              defaultValue={
                correction
                  ? String(
                      Math.abs(
                        units
                          ? (correction.units ?? 0)
                          : (correction.amount_cents ?? 0) / 100,
                      ),
                    )
                  : ""
              }
            />
          </label>
          <label>
            Transaction / confirmation date
            <input
              name="date"
              type="date"
              required
              max={localDate()}
              defaultValue={correction?.transaction_date ?? localDate()}
            />
          </label>
        </div>
        <p className="hint">
          Late-posting credits can be attached to an earlier period. A purchase
          must fall inside the period. A purchase refund does not prove the
          issuer reversed a benefit—use “Needs review” unless verified.
        </p>
        <label>
          Merchant or provider (optional)
          <input
            name="merchant"
            maxLength={200}
            defaultValue={correction?.merchant ?? ""}
          />
        </label>
        <label>
          What did you verify?
          <textarea
            name="notes"
            required
            maxLength={4000}
            rows={3}
            placeholder="A brief note is enough. Do not paste full statements or account numbers."
          />
        </label>
        <label className="check">
          <input type="checkbox" required /> This assessment is supported by the
          evidence I reviewed.
        </label>
        <ErrorText error={error} />
        <button className="primary" disabled={busy || offline}>
          {busy ? "Saving…" : correction ? "Save correction" : "Save evidence"}
        </button>
      </form>
    </Dialog>
  );
}

export function RejectForm({
  evidence,
  period,
  onClose,
}: {
  evidence: Evidence;
  period: Period;
  onClose: () => void;
}) {
  const { refresh, notice, offline } = useApp(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [id] = useState(() => crypto.randomUUID());
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await run("recordEvidence", {
        id,
        benefit_period_id: period.id,
        source_type:
          evidence.source_type as OperationInput<"recordEvidence">["source_type"],
        transaction_date: evidence.transaction_date,
        amount_cents: evidence.amount_cents,
        units: evidence.units,
        confidence: "rejected",
        eligibility_result: "ineligible",
        notes: text(f, "notes"),
        supersedes_evidence_id: evidence.id,
      });
      await refresh();
      notice("Candidate rejected; original evidence preserved.");
      onClose();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="Reject candidate" onClose={onClose}>
      <form className="form-stack" onSubmit={submit}>
        <p>Keep a brief explanation for your future self.</p>
        <label>
          Reason
          <textarea required name="notes" rows={3} />
        </label>
        <ErrorText error={error} />
        <button className="primary" disabled={busy || offline}>
          Save rejection
        </button>
      </form>
    </Dialog>
  );
}
export function NoteForm({
  period,
  onClose,
}: {
  period: Period;
  onClose: () => void;
}) {
  const { refresh, notice, offline } = useApp(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await run("setPeriodNote", { id: period.id, notes: text(f, "notes") });
      await refresh();
      notice("Note saved in the audit history.");
      onClose();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="Add a period note" onClose={onClose}>
      <form className="form-stack" onSubmit={submit}>
        <label>
          Note
          <textarea
            name="notes"
            rows={4}
            maxLength={4000}
            defaultValue={period.notes}
          />
        </label>
        <ErrorText error={error} />
        <button className="primary" disabled={busy || offline}>
          Save note
        </button>
      </form>
    </Dialog>
  );
}
export function CoverageForm({
  periods,
  onClose,
}: {
  periods: Period[];
  onClose: () => void;
}) {
  const { refresh, notice, offline } = useApp(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [coverage, setCoverage] = useState("partial"),
    [key] = useState(() => crypto.randomUUID());
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const ids = f.getAll("period");
      if (!ids.length) throw new Error("Choose at least one period.");
      const through = text(f, "through");
      if (through > localDate())
        throw new Error("Coverage cannot be in the future.");
      const data = (await run("applyReconciliation", {
        request_key: key,
        periods: ids.map((id) => ({
          id: String(id),
          coverage_status: coverage as "complete" | "partial" | "unavailable",
          coverage_through: through || null,
        })),
        description: text(f, "description"),
      })) as SyncRun;
      if (data.status === "failed")
        throw new Error(data.error_summary ?? "Reconciliation failed.");
      await refresh();
      notice("Coverage recorded. Candidate evidence stays unconfirmed.");
      onClose();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="Record a manual reconciliation" onClose={onClose}>
      <p className="dialog-intro">
        This records what you checked. It does not fetch bank transactions or
        connect to ChatGPT Finances.
      </p>
      <form className="form-stack" onSubmit={submit}>
        <fieldset>
          <legend>Periods checked</legend>
          {periods.map((p) => (
            <label className="check" key={p.id}>
              <input name="period" type="checkbox" value={p.id} />
              {p.card_name} · {p.benefit_name} · {p.period_start}
            </label>
          ))}
        </fieldset>
        <label>
          Transaction coverage
          <select
            value={coverage}
            onChange={(e) => setCoverage(e.target.value)}
          >
            <option value="partial">Partial — some records missing</option>
            <option value="unavailable">Unavailable — unable to check</option>
            <option value="complete">
              Complete — verified through date below
            </option>
          </select>
        </label>
        <label>
          Observed through
          <input
            name="through"
            type="date"
            required={coverage === "complete"}
            max={localDate()}
            defaultValue={localDate()}
          />
        </label>
        <label>
          What was checked, and what was missing?
          <textarea name="description" required rows={3} />
        </label>
        {coverage === "complete" && (
          <label className="check">
            <input type="checkbox" required /> I checked complete transaction
            coverage, including late credits and reversals, through this date.
          </label>
        )}
        <ErrorText error={error} />
        <button
          className="primary"
          disabled={busy || offline || !periods.length}
        >
          {busy ? "Saving…" : "Save reconciliation"}
        </button>
      </form>
    </Dialog>
  );
}
