"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, X } from "lucide-react";
import { run } from "@/lib/api";
import {
  ALERT_LABELS,
  deriveAlerts,
  type Alert,
  type AlertKind,
} from "@/lib/alerts";
import { useApp } from "./provider";

// Alerts are derived from the snapshot on every render; nothing is stored except acknowledgements.
export function useAlerts(): Alert[] {
  const { data } = useApp();
  return useMemo(
    () =>
      deriveAlerts({
        data,
        leadDays: data.settings.alert_lead_days,
        acknowledged: data.acknowledgements.map((a) => a.alert_key),
      }),
    [data],
  );
}
const ACTIONS: Record<AlertKind, string> = {
  setup: "Confirm card",
  account_link: "Link account",
  terms_changed: "Review terms",
  allowance_needed: "Set allowance",
  candidate: "Review",
  expiring: "Open card",
  reverify: "Open card",
  sync_failing: "Check sync",
  coverage_stale: "Reconcile",
  no_period: "Open cards",
  completed: "History",
  used: "Open card",
};
const TONE: Partial<Record<AlertKind, string>> = {
  setup: "warning",
  account_link: "warning",
  terms_changed: "warning",
  allowance_needed: "warning",
  candidate: "warning",
  expiring: "accent",
  reverify: "neutral",
  sync_failing: "danger",
  coverage_stale: "neutral",
  no_period: "danger",
  completed: "success",
  used: "success",
};
export function AlertStack({
  alerts,
  limit,
  moreHref,
  empty,
}: {
  alerts: Alert[];
  limit?: number;
  moreHref?: string;
  empty?: string;
}) {
  const { refresh, offline } = useApp(),
    [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  const shown = limit ? alerts.slice(0, limit) : alerts,
    hidden = alerts.length - shown.length;
  async function acknowledge(a: Alert) {
    setBusy(a.key);
    setError("");
    try {
      await run("acknowledgeAlert", { alert_key: a.key, context: a.context });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not dismiss.");
    } finally {
      setBusy("");
    }
  }
  if (!alerts.length)
    return empty ? <p className="alert-empty">{empty}</p> : null;
  return (
    <div className="alert-stack">
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <ul>
        {shown.map((a) => (
          <li key={a.key} className={`alert-item ${TONE[a.kind] ?? "neutral"}`}>
            <span className={`alert-kind ${TONE[a.kind] ?? "neutral"}`}>
              {ALERT_LABELS[a.kind]}
            </span>
            <div className="alert-text">
              <strong>{a.title}</strong>
              <span>{a.detail}</span>
            </div>
            <div className="alert-actions">
              <Link href={a.href} className="text-button">
                {ACTIONS[a.kind]} <ArrowUpRight size={14} />
              </Link>
              {a.dismissible && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Dismiss: ${a.title}`}
                  disabled={busy === a.key || offline}
                  onClick={() => void acknowledge(a)}
                >
                  <X size={16} />
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {hidden > 0 && moreHref && (
        <Link href={moreHref} className="text-button alert-more">
          {hidden} more <ArrowUpRight size={14} />
        </Link>
      )}
    </div>
  );
}
