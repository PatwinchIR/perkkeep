"use client";
import { useState } from "react";
import { ImageUp, Sparkles, Trash2 } from "lucide-react";
import { faceFor } from "@/lib/card-faces";
import type { Card } from "@/lib/types";
import { useApp } from "./provider";
import { CardFace } from "./ui";

async function send(cardId: string, init: RequestInit, query = "") {
  const r = await fetch(`/api/card-art/${cardId}${query}`, {
    credentials: "same-origin",
    cache: "no-store",
    ...init,
  });
  if (!r.ok) {
    const body = await r.json().catch(() => null);
    throw new Error(body?.error?.message ?? "Could not update the card image.");
  }
}

// Owner-only card art controls. Images are stored privately in the ledger database.
export function CardArtPanel({ card }: { card: Card }) {
  const { data, refresh, notice, offline } = useApp(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [overlayUpload, setOverlayUpload] = useState(false);
  const art = data.cardArt.find((a) => a.card_id === card.id),
    official = faceFor(card).art;
  async function act(fn: () => Promise<void>, done: string) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
      notice(done);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not update the card image.",
      );
    } finally {
      setBusy(false);
    }
  }
  const json = (body: object): RequestInit => ({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (
    <section className="card-art-panel" aria-labelledby="card-art-title">
      <CardFace card={card} large />
      <div className="form-stack">
        <h2 id="card-art-title">Card image</h2>
        <p className="hint">
          {art
            ? art.origin === "issuer"
              ? "The issuer’s product image, kept private in your ledger."
              : "Your uploaded image, kept private in your ledger."
            : official
              ? "A plain face is shown until you add the issuer’s image or your own."
              : card.product_name
                ? "No clean issuer image is known for this product. Upload a photo of your card to replace the plain face."
                : "This card keeps a plain face until its product is confirmed."}
        </p>
        {official && art?.origin !== "issuer" && (
          <button
            className="secondary"
            disabled={busy || offline}
            onClick={() =>
              void act(
                () => send(card.id, json({ action: "official" })),
                "Issuer image added.",
              )
            }
          >
            <Sparkles size={16} /> Use the issuer’s image
          </button>
        )}
        <label>
          Upload an image or a photo of your card
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/heic,image/heif"
            disabled={busy || offline}
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              e.currentTarget.value = "";
              if (file)
                void act(
                  () =>
                    send(
                      card.id,
                      {
                        method: "POST",
                        headers: { "Content-Type": file.type || "image/jpeg" },
                        body: file,
                      },
                      `?overlay=${overlayUpload ? 1 : 0}`,
                    ),
                  "Card image saved.",
                );
            }}
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={overlayUpload}
            onChange={(e) => setOverlayUpload(e.target.checked)}
          />{" "}
          Draw my name and last four on uploaded images
        </label>
        {art && (
          <>
            <label className="check">
              <input
                type="checkbox"
                checked={art.overlay}
                disabled={busy || offline}
                onChange={(e) => {
                  const overlay = e.target.checked;
                  void act(
                    () => send(card.id, json({ action: "overlay", overlay })),
                    "Card image updated.",
                  );
                }}
              />{" "}
              Show my name and last four on this image
            </label>
            <button
              className="text-button"
              disabled={busy || offline}
              onClick={() =>
                void act(
                  () => send(card.id, { method: "DELETE" }),
                  "Card image removed.",
                )
              }
            >
              <Trash2 size={15} /> Remove image
            </button>
          </>
        )}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <p className="fine-print">
          <ImageUp size={13} /> Images are resized to a standard card shape and
          are never cached on this device.
        </p>
      </div>
    </section>
  );
}
