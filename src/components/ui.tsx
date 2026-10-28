"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { X, ArrowUpRight, Leaf } from "lucide-react";
import Link from "next/link";
import type { Period, Card } from "@/lib/types";
import {
  STATUS_LABELS,
  status,
  money,
  knownAvailable,
  cardEnding,
} from "@/lib/domain";
export function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={onClose}
      onClose={onClose}
      aria-labelledby="dialog-title"
    >
      <div className="dialog-heading">
        <h2 id="dialog-title">{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Badge({ period }: { period: Period }) {
  const s = status(period);
  return <span className={`badge ${s}`}>{STATUS_LABELS[s]}</span>;
}
export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-symbol">
        <Leaf size={25} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
export function CardTile({ card, periods }: { card: Card; periods: Period[] }) {
  const known = periods
    .map((p) => knownAvailable(p))
    .filter((n): n is number => n !== null);
  return (
    <Link href={`/cards/${card.id}`} className="card-tile">
      <div
        className={`card-face ${card.issuer === "American Express" ? "amex" : card.issuer === "Discover" ? "discover" : "chase"}`}
      >
        <div>
          <span className="card-issuer">{card.issuer}</span>
          <ArrowUpRight size={19} />
        </div>
        <strong>{card.display_name}</strong>
        <div>
          <span className="chip" />
          <span className="card-digits">{cardEnding(card.last4)}</span>
        </div>
      </div>
      <div className="card-tile-details">
        <strong>
          {card.identity_verified_at
            ? `${periods.length} current ${periods.length === 1 ? "benefit" : "benefits"}`
            : "Confirm card identity"}
        </strong>
        <span>
          {known.length
            ? `${money(known.reduce((a, b) => a + b, 0))} known available`
            : card.product_name
              ? "Ready when you are"
              : "Product not yet identified"}
        </span>
      </div>
    </Link>
  );
}
