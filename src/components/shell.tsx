"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  WalletCards,
  ListChecks,
  History,
  Settings2,
  Leaf,
  RefreshCw,
  ArrowUpRight,
} from "lucide-react";
import { useApp } from "./provider";
import type { ReactNode } from "react";
const nav = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/cards", label: "My cards", icon: WalletCards },
  { href: "/review", label: "Review", icon: ListChecks },
  { href: "/history", label: "History", icon: History },
  { href: "/settings", label: "Settings", icon: Settings2 },
];
export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname(),
    { busy, refresh, data, session } = useApp();
  const latest = data.runs[0],
    lastSuccess = data.runs.find((r) => r.status === "success");
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
        <div className="sidebar-caption">YOUR PERSONAL LEDGER</div>
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
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="little-leaf">
            <Leaf size={20} />
          </div>
          <p>
            A benefit remembered
            <br />
            is a benefit enjoyed.
          </p>
          <Link href="/settings#install">
            Take Perkkeep with you <ArrowUpRight size={14} />
          </Link>
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
            <span
              className={`state-dot ${latest?.status === "failed" ? "failed" : ""}`}
            />
            <span>
              {latest
                ? `Last checked ${new Date(latest.finished_at ?? latest.started_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                : "Not reconciled yet"}
            </span>
            <span className="desktop-only">
              ·{" "}
              {latest?.status === "success"
                ? "Complete reported coverage"
                : latest?.status === "failed"
                  ? "Last check failed"
                  : "Coverage not established"}
            </span>
          </div>
          <button
            className="icon-button refresh-button"
            disabled={busy}
            onClick={() => void refresh()}
            aria-label="Refresh records"
          >
            <RefreshCw size={16} className={busy ? "spin" : ""} />
            <span>Refresh</span>
          </button>
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
