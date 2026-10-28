import { z } from "zod";
import { checkAccess, deny, originAllowed } from "@/server/access";
import { withOwner } from "@/server/db";
import { fetchIssuerImage, normalizeCardImage } from "@/server/card-art";
import { faceFor } from "@/lib/card-faces";
import { failure, json } from "@/server/respond";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
type Context = { params: Promise<{ id: string }> };
const cardId = z.uuid();

async function owner(context: Context) {
  const id = cardId.safeParse((await context.params).id);
  if (!id.success) return { error: deny(404, "not_found", "Not found.") };
  const access = await checkAccess();
  if (!access.ok)
    return { error: deny(access.status, access.code, access.message) };
  return { id: id.data, ownerId: access.ownerId };
}

// Private image bytes: never cached by the browser, the service worker or a CDN.
export async function GET(_request: Request, context: Context) {
  try {
    const who = await owner(context);
    if ("error" in who) return who.error;
    const row = await withOwner(who.ownerId, async (tx) => {
      const { rows } = await tx.query(
        "select image, content_type from public.card_art where card_id=$1",
        [who.id],
      );
      return rows[0] as { image: Buffer; content_type: string } | undefined;
    });
    if (!row) return deny(404, "not_found", "No image for this card.");
    return new Response(new Uint8Array(row.image), {
      headers: {
        "Content-Type": row.content_type,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return failure(e);
  }
}

const settings = z.discriminatedUnion("action", [
  z.object({ action: z.literal("official") }),
  z.object({ action: z.literal("overlay"), overlay: z.boolean() }),
]);

// JSON {action:"official"} stores the allowlisted issuer image; an image body stores an upload.
export async function POST(request: Request, context: Context) {
  if (!originAllowed(request))
    return deny(403, "origin", "Request origin is not allowed.");
  try {
    const who = await owner(context);
    if ("error" in who) return who.error;
    const type = request.headers.get("content-type") ?? "";
    const card = await withOwner(who.ownerId, async (tx) => {
      const { rows } = await tx.query(
        "select id, catalog_key, product_name from public.cards where id=$1",
        [who.id],
      );
      return rows[0];
    });
    if (!card) return deny(404, "not_found", "Card not found.");
    let stored: {
      origin: string;
      source_url: string | null;
      bands: unknown[];
      overlay: boolean;
      image: Buffer;
      sha: string;
    };
    if (type.startsWith("application/json")) {
      const body = settings.safeParse(await request.json().catch(() => null));
      if (!body.success) return deny(400, "invalid", "Invalid request.");
      if (body.data.action === "overlay") {
        const overlay = body.data.overlay;
        const updated = await withOwner(who.ownerId, (tx) =>
          tx.query("update public.card_art set overlay=$2 where card_id=$1", [
            who.id,
            overlay,
          ]),
        );
        return updated.rowCount
          ? json({ overlay })
          : deny(404, "not_found", "No image for this card.");
      }
      const art = faceFor(card).art;
      if (!art)
        return deny(
          400,
          "no_official",
          "No clean issuer image is known for this card. Upload one instead.",
        );
      const normalized = await normalizeCardImage(
        await fetchIssuerImage(art.image),
        "issuer",
        art.crop,
      );
      stored = {
        origin: "issuer",
        source_url: art.image,
        bands: art.bands,
        overlay: true,
        image: normalized.bytes,
        sha: normalized.sha256,
      };
    } else if (type.startsWith("image/")) {
      const normalized = await normalizeCardImage(
        Buffer.from(await request.arrayBuffer()),
        "upload",
      );
      const overlay = new URL(request.url).searchParams.get("overlay") === "1";
      stored = {
        origin: "upload",
        source_url: null,
        bands: [],
        overlay,
        image: normalized.bytes,
        sha: normalized.sha256,
      };
    } else return deny(415, "unsupported", "Send an image or a JSON action.");
    const row = await withOwner(who.ownerId, async (tx) => {
      const { rows } = await tx.query(
        `insert into public.card_art(card_id,image,content_type,sha256,origin,source_url,bands,overlay)
         values($1,$2,'image/webp',$3,$4,$5,$6,$7)
         on conflict(card_id) do update set image=excluded.image, content_type=excluded.content_type, sha256=excluded.sha256,
           origin=excluded.origin, source_url=excluded.source_url, bands=excluded.bands, overlay=excluded.overlay
         returning card_id, sha256, origin, bands, overlay, updated_at`,
        [
          who.id,
          stored.image,
          stored.sha,
          stored.origin,
          stored.source_url,
          JSON.stringify(stored.bands),
          stored.overlay,
        ],
      );
      return rows[0];
    });
    return json(row);
  } catch (e) {
    if (
      e instanceof Error &&
      /Images must|Use a PNG|not allowlisted|issuer image|did not return/.test(
        e.message,
      )
    )
      return deny(400, "image", e.message);
    return failure(e);
  }
}

export async function DELETE(request: Request, context: Context) {
  if (!originAllowed(request))
    return deny(403, "origin", "Request origin is not allowed.");
  try {
    const who = await owner(context);
    if ("error" in who) return who.error;
    await withOwner(who.ownerId, (tx) =>
      tx.query("delete from public.card_art where card_id=$1", [who.id]),
    );
    return new Response(null, { status: 204 });
  } catch (e) {
    return failure(e);
  }
}
