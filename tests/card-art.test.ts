// Card art tests. Images here are generated synthetic shapes, not issuer artwork.
import { afterAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { appPool, insert, user } from "./helpers";
import { faceFor } from "../src/lib/card-faces";
import {
  fetchIssuerImage,
  normalizeCardImage,
  FACE,
} from "../src/server/card-art";
afterAll(() => appPool.end());

describe("card faces", () => {
  it("uses product art by catalog key or confirmed product, and keeps the unidentified record plain", () => {
    expect(
      faceFor({
        catalog_key: "amex-gold",
        product_name: "American Express Gold",
      }).art?.bands,
    ).toHaveLength(3);
    expect(
      faceFor({ catalog_key: "chase-unidentified", product_name: null }),
    ).toMatchObject({ key: "chase-unidentified", art: undefined });
    expect(
      faceFor({
        catalog_key: "chase-unidentified",
        product_name: "Chase Ink Business Cash",
      }).key,
    ).toBe("chase-ink-business-cash");
    expect(
      faceFor({ catalog_key: "chase-freedom-unlimited", product_name: null })
        .art,
    ).toBeUndefined();
    expect(
      faceFor({ catalog_key: null, product_name: "Synthetic card" }).key,
    ).toBeNull();
  });
});

describe("image normalization", () => {
  it("trims transparent margins from issuer art and outputs one 1.586:1 WebP size", async () => {
    const card = await sharp({
      create: { width: 300, height: 190, channels: 4, background: "#1a5fb4" },
    })
      .png()
      .toBuffer();
    const padded = await sharp({
      create: {
        width: 400,
        height: 300,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([{ input: card, left: 50, top: 55 }])
      .png()
      .toBuffer();
    const out = await normalizeCardImage(padded, "issuer");
    const meta = await sharp(out.bytes).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual([
      "webp",
      FACE.width,
      FACE.height,
    ]);
    const corner = await sharp(out.bytes)
      .extract({ left: 2, top: 2, width: 4, height: 4 })
      .raw()
      .toBuffer();
    expect(corner[2]).toBeGreaterThan(150); // blue card fills the frame, no white margin
    await expect(
      normalizeCardImage(Buffer.from("not an image"), "upload"),
    ).rejects.toThrow();
  });
  it("fetches only allowlisted issuer hosts over HTTPS", async () => {
    await expect(
      fetchIssuerImage("https://evil.example.com/card.png"),
    ).rejects.toThrow(/allowlisted/);
    await expect(
      fetchIssuerImage("http://creditcards.chase.com/card.png"),
    ).rejects.toThrow(/allowlisted/);
  });
});

describe("card art storage", () => {
  it("is visible only to the card's owner", async () => {
    const alice = await user(),
      bob = await user();
    const card = await insert(alice, "cards", {
      issuer: "Synthetic",
      display_name: "Synthetic",
    });
    const bytes = (
      await normalizeCardImage(
        await sharp({
          create: { width: 160, height: 101, channels: 3, background: "#777" },
        })
          .png()
          .toBuffer(),
        "upload",
      )
    ).bytes;
    await alice.q(
      "insert into public.card_art(card_id,image,content_type,sha256,origin) values($1,$2,'image/webp',$3,'upload')",
      [card.id, bytes, "a".repeat(64)],
    );
    expect(await bob.q("select card_id from public.card_art")).toHaveLength(0);
    await expect(
      bob.q(
        "insert into public.card_art(card_id,image,content_type,sha256,origin) values($1,$2,'image/webp',$3,'upload')",
        [card.id, bytes, "b".repeat(64)],
      ),
    ).rejects.toThrow();
    expect(
      await bob.q(
        "delete from public.card_art where card_id=$1 returning card_id",
        [card.id],
      ),
    ).toHaveLength(0);
    expect(await alice.q("select card_id from public.card_art")).toHaveLength(
      1,
    );
  });
});
