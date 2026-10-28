import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
} from "node:crypto";

// PERKKEEP_ENCRYPTION_KEY is 32 random bytes, base64-encoded, held only in the server environment.
function masterKey(): Buffer {
  const raw = process.env.PERKKEEP_ENCRYPTION_KEY;
  const key = raw ? Buffer.from(raw, "base64") : Buffer.alloc(0);
  if (key.length !== 32)
    throw new Error(
      "PERKKEEP_ENCRYPTION_KEY must be 32 bytes, base64-encoded.",
    );
  return key;
}
const derive = (purpose: string) =>
  Buffer.from(hkdfSync("sha256", masterKey(), Buffer.alloc(0), purpose, 32));

// AES-256-GCM. Stored as v1.<iv>.<tag>.<ciphertext> in base64url; the label binds the ciphertext
// to its purpose so a token cannot be swapped into another column.
export function encryptSecret(plain: string, label: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    derive("perkkeep-secrets-v1"),
    iv,
  );
  cipher.setAAD(Buffer.from(label));
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), body]
    .map((p) => (typeof p === "string" ? p : p.toString("base64url")))
    .join(".");
}
export function decryptSecret(stored: string, label: string): string {
  const [version, iv, tag, body] = stored.split(".");
  if (version !== "v1" || !iv || !tag || !body)
    throw new Error("Unrecognized secret format.");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    derive("perkkeep-secrets-v1"),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAAD(Buffer.from(label));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(body, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

// Keyed digests stand in for source identifiers, so raw account and transaction ids are never stored.
export function reference(namespace: string, value: string): string {
  return createHmac("sha256", derive("perkkeep-references-v1"))
    .update(`${namespace}\u0000${value}`)
    .digest("hex");
}
export const sha256 = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
