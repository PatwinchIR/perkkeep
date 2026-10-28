"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { X, ArrowUpRight, Leaf } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { cardDesign } from "@/lib/card-art";
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
export function CardArt({
  card,
  sizes = "320px",
}: {
  card: Pick<Card, "product_name" | "art_design" | "issuer">;
  sizes?: string;
}) {
  const design = cardDesign(card);
  if (!design) return null;
  const alt = `${card.product_name} product image from ${card.issuer}`;
  if (!design.crop)
    return (
      <Image
        className="card-art-image"
        src={design.src}
        alt={alt}
        width={design.width}
        height={design.height}
        sizes={sizes}
      />
    );
  const { x, y, w, h } = design.crop;
  return (
    <div className="card-art-crop" style={{ aspectRatio: `${w} / ${h}` }}>
      <Image
        src={design.src}
        alt={alt}
        width={design.width}
        height={design.height}
        sizes={`${Math.round((design.width / w) * 320)}px`}
        style={{
          position: "absolute",
          maxWidth: "none",
          width: `${(design.width / w) * 100}%`,
          height: "auto",
          left: `${(-x / w) * 100}%`,
          top: `${(-y / h) * 100}%`,
        }}
      />
    </div>
  );
}

export function CardTile({ card, periods }: { card: Card; periods: Period[] }) {
  const known = periods
    .map((p) => knownAvailable(p))
    .filter((n): n is number => n !== null);
  const art = !!cardDesign(card);
  return (
    <Link href={`/cards/${card.id}`} className="card-tile">
      {art ? (
        <div className="card-face art">
          <CardArt card={card} />
        </div>
      ) : (
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
      )}
      <div className="card-tile-details">
        {art && (
          <span className="card-tile-name">
            {card.display_name} · {cardEnding(card.last4)}
          </span>
        )}
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
