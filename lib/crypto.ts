import "server-only";
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

// AES-256-GCM for data that must be readable later (payout account numbers). Key: C50_DATA_KEY,
// 32 random bytes in base64, set in Vercel. Never stored in the database.
function key(): Buffer {
  const k = Buffer.from(process.env.C50_DATA_KEY ?? "", "base64");
  if (k.length !== 32) throw new Error("C50_DATA_KEY must be 32 bytes, base64");
  return k;
}

export const dataKeyConfigured = () => Buffer.from(process.env.C50_DATA_KEY ?? "", "base64").length === 32;

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}

export function decrypt(sealed: string): string {
  const [v, iv, tag, ct] = sealed.split(":");
  if (v !== "v1") throw new Error("unknown ciphertext version");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
}

// Same input -> same output, without revealing the input (for spotting duplicates).
export const keyedHash = (s: string) => createHmac("sha256", key()).update(s).digest("hex");
