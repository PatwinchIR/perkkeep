"use client";
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
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
import { faceFor } from "@/lib/card-faces";
import { useApp } from "./provider";
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
// Private card art when the owner has stored it; otherwise a neutral face in the issuer's color
// family with the product name as text and no logos. Name and last four are CSS text overlays.
export function CardFace({
  card,
  large = false,
}: {
  card: Card;
  large?: boolean;
}) {
  const { data, session } = useApp();
  const face = faceFor(card),
    art = data.cardArt.find((a) => a.card_id === card.id);
  const style = {
    "--face-a": face.placeholder[0],
    "--face-b": face.placeholder[1],
    color: face.text,
  } as CSSProperties;
  const overlay = !art || art.overlay;
  const at = (p: { x: number; y: number }) => ({
    left: `${p.x}%`,
    top: `${p.y}%`,
  });
  return (
    <div
      className={`card-face${large ? " large" : ""}${art ? " has-art" : ""}`}
      style={style}
    >
      {art ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- private, uncached image */}
          <img
            className="face-art"
            src={`/api/card-art/${card.id}?v=${art.sha256.slice(0, 12)}`}
            alt=""
          />
          {art.bands.map((b, i) => (
            <span
              key={i}
              className="face-band"
              style={{
                left: `${b.x}%`,
                top: `${b.y}%`,
                width: `${b.w}%`,
                height: `${b.h}%`,
                background: b.color,
                boxShadow: `0 0 1.4cqw 0.7cqw ${b.color}`,
              }}
            />
          ))}
        </>
      ) : (
        <>
          <div>
            <span className="card-issuer">{card.issuer}</span>
            <ArrowUpRight size={19} />
          </div>
          <strong>{card.product_name ?? card.display_name}</strong>
          <span className="chip" />
        </>
      )}
      {overlay && session.name && (
        <span className="face-text face-name" style={at(face.name)}>
          {session.name}
        </span>
      )}
      {overlay && (
        <span className="face-text card-digits" style={at(face.number)}>
          {art && !card.last4
            ? ""
            : face.digitsOnly && card.last4
              ? card.last4
              : cardEnding(card.last4)}
        </span>
      )}
    </div>
  );
}
export function CardTile({ card, periods }: { card: Card; periods: Period[] }) {
  const known = periods
    .map((p) => knownAvailable(p))
    .filter((n): n is number => n !== null);
  return (
    <Link href={`/cards/${card.id}`} className="card-tile">
      <CardFace card={card} />
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
