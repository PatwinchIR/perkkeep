"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  House,
  WalletCards,
  ListChecks,
  History,
  Settings2,
  Leaf,
  RefreshCw,
} from "lucide-react";
import { useApp } from "./provider";
import { useAlerts } from "./alerts";
import { reviewQueue } from "@/lib/review";
import { accountFreshness, shiftDays } from "@/lib/domain";
import { shortDate } from "@/lib/benefit-status";
import type { ReactNode } from "react";
const nav = [
  { href: "/", label: "Home", icon: House },
  { href: "/cards", label: "Cards", icon: WalletCards },
  { href: "/review", label: "Review", icon: ListChecks },
  { href: "/history", label: "History", icon: History },
  { href: "/settings", label: "Settings", icon: Settings2 },
];
export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname(),
    { busy, refresh, data, session } = useApp(),
    alerts = useAlerts(),
    needs = reviewQueue(data, alerts).count;
  const latest = data.runs[0],
    lastSuccess = data.runs.find((r) => r.status === "success");
  const refreshButton = (
    <button
      className="icon-button refresh-button"
      disabled={busy}
      onClick={() => void refresh()}
      aria-label="Refresh records"
    >
      <RefreshCw size={16} className={busy ? "spin" : ""} />
      <span>Refresh</span>
    </button>
  );
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <Link href="/" className="brand">
          <span className="brand-mark">
            <Leaf size={23} />
          </span>
          perkkeep<span className="brand-dot">.</span>
        </Link>
        <div className="eyebrow sidebar-caption">Your personal ledger</div>
        <nav aria-label="Main navigation">
          {nav.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={
                pathname === href ||
                (href === "/cards" && pathname.startsWith("/cards/"))
                  ? "nav-link active"
                  : "nav-link"
              }
              aria-current={pathname === href ? "page" : undefined}
            >
              <Icon size={19} />
              {label}
              {href === "/review" && needs > 0 && (
                <span className="nav-badge">
                  {needs}
                  <span className="sr-only"> items need attention</span>
                </span>
              )}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <SyncStatus />
          {refreshButton}
        </div>
        <div className="account">
          <span className="avatar">
            {session.email.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <strong>Personal workspace</strong>
            <span>{session.email}</span>
          </div>
        </div>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <span className="mobile-brand">
            perkkeep<span>.</span>
          </span>
          <div className="sync-state">
            <SyncStatus compact />
          </div>
          {refreshButton}
        </header>
        {latest?.status === "failed" && (
          <div className="inline-warning">
            Last reconciliation failed: {latest.error_summary}. Last successful
            check:{" "}
            {lastSuccess
              ? new Date(lastSuccess.finished_at!).toLocaleString()
              : "none yet"}
            .
          </div>
        )}
        {data.pendingMigration && (
          <div className="inline-warning" role="status">
            Database migration {data.pendingMigration} has not been applied yet,
            so some features wait for it. Run <code>npm run neon:migrate</code>.
          </div>
        )}
        <main id="main" tabIndex={-1}>
          {children}
        </main>
        <footer className="app-footer">
          <span>
            <LockIcon /> Private by design
          </span>
          <span>A view of your last verified records</span>
        </footer>
      </div>
    </div>
  );
}
// Sync status (rule 13): when the newest linked account was synced through, and each linked card
// whose account is behind, failing or stale. Without linked accounts, the last reconciliation.
function SyncStatus({ compact = false }: { compact?: boolean }) {
  const { data } = useApp(),
    now = new Date(),
    linked = data.accounts.filter(
      (a) => a.mapping_status === "confirmed" && a.card_id,
    ),
    through = linked
      .filter((a) => accountFreshness(a, now) === "current")
      .map((a) => a.synced_through)
      .filter((d): d is string => !!d)
      .sort()
      .at(-1),
    behind = linked.filter(
      (a) =>
        accountFreshness(a, now) !== "current" ||
        !a.synced_through ||
        (!!through && a.synced_through < shiftDays(through, -3)),
    ),
    latest = data.runs[0];
  if (!linked.length)
    return (
      <p className="sync-status">
        <span
          className={`state-dot ${latest?.status === "failed" ? "failed" : ""}`}
        />
        {latest
          ? `Last checked ${new Date(latest.finished_at ?? latest.started_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
          : "Not reconciled yet"}
      </p>
    );
  const name = (a: (typeof linked)[number]) =>
    data.cards.find((c) => c.id === a.card_id)?.display_name ?? a.name;
  return (
    <p className="sync-status">
      <span className={`state-dot ${behind.length ? "failed" : ""}`} />
      {through ? `Synced through ${shortDate(through)}` : "Not synced yet"}
      {behind.length > 0 && !compact && (
        <span className="sync-behind">
          {behind.map((a) => (
            <Link key={a.id} href="/settings">
              {name(a)}{" "}
              {a.synced_through
                ? `through ${shortDate(a.synced_through)}`
                : "not synced"}
            </Link>
          ))}
        </span>
      )}
      {behind.length > 0 && compact && (
        <Link href="/settings" className="sync-behind-count">
          {behind.length} behind
        </Link>
      )}
    </p>
  );
}
function LockIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <rect x="3" y="7" width="10" height="7" rx="2" stroke="currentColor" />
      <path d="M5 7V5a3 3 0 0 1 6 0v2" stroke="currentColor" />
    </svg>
  );
}
