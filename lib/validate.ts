// Pakistani mobile: accepts "300 1234567", "03001234567", "+923001234567".
export function normalizePkPhone(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const d = input.replace(/\D/g, "").replace(/^92/, "").replace(/^0/, "");
  return /^3\d{9}$/.test(d) ? `+92${d}` : null;
}

export function normalizeEmail(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const e = input.trim().toLowerCase();
  return e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) ? e : null;
}

// Letters (any script), spaces, dot, apostrophe, hyphen. First and last name.
export function cleanFullName(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const n = input.trim().replace(/\s+/g, " ");
  return /^[\p{L}][\p{L} .'-]{2,58}[\p{L}.]$/u.test(n) && n.split(" ").length >= 2 ? n : null;
}

// Same 4 rules as the sign-up meter; at least 3 must pass and length is required.
export function passwordStrongEnough(p: unknown): p is string {
  if (typeof p !== "string" || p.length < 8 || p.length > 72) return false;
  return [/[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(p)).length >= 2;
}

export function cleanReferralCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const c = input.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
  return c.length >= 4 ? c : null;
}
