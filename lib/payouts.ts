import { createHash } from "node:crypto";

export const PAYOUT_TYPES = ["jazz", "easy", "bank", "usdt"] as const;
export type PayoutType = (typeof PAYOUT_TYPES)[number];

// ISO 13616 mod-97 check on a Pakistani IBAN: PK + 2 check digits + 4-letter bank code + 16 alphanumerics.
export function ibanOK(v: string): boolean {
  const s = v.replace(/\s/g, "").toUpperCase();
  if (!/^PK\d{2}[A-Z]{4}[0-9A-Z]{16}$/.test(s)) return false;
  const digits = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let r = 0;
  for (const ch of digits) r = (r * 10 + Number(ch)) % 97;
  return r === 1;
}

export const mobileOK = (v: string) => /^03\d{9}$/.test(v);

// TRON address: base58check, 25 bytes starting 0x41, checksum = first 4 bytes of sha256(sha256(payload)).
export function trc20OK(v: string): boolean {
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(v)) return false;
  const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = BigInt(0);
  for (const c of v) n = n * BigInt(58) + BigInt(A.indexOf(c));
  const bytes = Buffer.from(n.toString(16).padStart(50, "0"), "hex");
  if (bytes.length !== 25 || bytes[0] !== 0x41) return false;
  const sum = createHash("sha256").update(createHash("sha256").update(bytes.subarray(0, 21)).digest()).digest();
  return sum.subarray(0, 4).equals(bytes.subarray(21));
}

// Same rule as the dashboard: at least two words of the account title appear in the CNIC name.
export function nameMatch(a: string, b: string): boolean {
  const words = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, "").split(/\s+/).filter(Boolean);
  const A = words(a), B = words(b);
  return A.length > 0 && B.length > 0 && A.filter((w) => B.includes(w)).length >= Math.min(2, Math.min(A.length, B.length));
}

export function normalizeAccount(type: PayoutType, raw: string): string {
  return type === "bank" ? raw.replace(/\s/g, "").toUpperCase() : raw.replace(/\s/g, "");
}

export function accountError(type: PayoutType, a: string): string | null {
  if (type === "bank") return ibanOK(a) ? null : "That IBAN doesn't check out. It should be 24 characters starting with PK.";
  if (type === "usdt") return trc20OK(a) ? null : "That isn't a valid TRC20 address (starts with T, 34 characters).";
  return mobileOK(a) ? null : "Enter an 11-digit number starting 03.";
}

export const accountHint = (a: string) => (a.length > 8 ? `${a.slice(0, 4)} •••• ${a.slice(-4)}` : a);

// The shape the dashboard keeps in ST.methods (the account is only ever sent masked).
export const methodToClient = (m: { id: string; type: string; account_hint: string; title: string; bank: string | null; ready_at: string }) =>
  ({ id: m.id, type: m.type, acct: m.account_hint, title: m.title, bank: m.bank ?? "", readyAt: Date.parse(m.ready_at) });
