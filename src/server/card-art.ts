import "server-only";
import sharp from "sharp";
import { sha256 } from "./crypto";
import type { Band } from "@/lib/card-faces";

// One size and ratio for every face (ISO/IEC 7810 ID-1 is 85.60 × 53.98 mm, about 1.586:1).
export const FACE = { width: 1012, height: 638 };
const MAX_INPUT = 8 * 1024 * 1024;

// Issuer images have transparent margins around a rounded card; trimming them first lets the
// cover crop fill the face. Photos are rotated by their EXIF orientation and center-cropped.
export async function normalizeCardImage(
  input: Buffer,
  origin: "issuer" | "upload",
  // Pixel region of one card when an issuer image shows several designs.
  crop?: { left: number; top: number; width: number; height: number },
) {
  if (!input.length || input.length > MAX_INPUT)
    throw new Error("Images must be under 8 MB.");
  let image = sharp(input, {
    failOn: "error",
    limitInputPixels: 40_000_000,
  }).rotate();
  const meta = await sharp(input).metadata();
  if (!["png", "jpeg", "webp", "avif", "heif"].includes(meta.format ?? ""))
    throw new Error("Use a PNG, JPEG, WebP or HEIF image.");
  if (origin === "issuer" && crop)
    image = sharp(await image.extract(crop).toBuffer());
  if (origin === "issuer" && meta.hasAlpha)
    image = sharp(await image.trim().toBuffer());
  const bytes = await image
    .resize(FACE.width, FACE.height, { fit: "cover", position: "centre" })
    .flatten({ background: "#ffffff" })
    .webp({ quality: 88 })
    .toBuffer();
  return { bytes, sha256: sha256(bytes), contentType: "image/webp" as const };
}

// Fetches only an issuer image URL listed in data/card-faces.json, never a caller-supplied URL.
export async function fetchIssuerImage(
  url: string,
  fetcher: typeof fetch = fetch,
) {
  const allowed = new URL(url);
  if (
    allowed.protocol !== "https:" ||
    ![
      "www.aexp-static.com",
      "icm.aexp-static.com",
      "creditcards.chase.com",
      "ecm.capitalone.com",
    ].includes(allowed.hostname)
  )
    throw new Error("Image host is not allowlisted.");
  const response = await fetcher(allowed, {
    headers: { Accept: "image/png,image/webp,image/*" },
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error(`The issuer image returned status ${response.status}.`);
  if (!(response.headers.get("content-type") ?? "").startsWith("image/"))
    throw new Error("The issuer URL did not return an image.");
  return Buffer.from(await response.arrayBuffer());
}

export const bandsJson = (bands: Band[]) => JSON.stringify(bands);
