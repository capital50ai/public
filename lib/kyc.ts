// KYC field rules. They mirror the dashboard's own checks, enforced again on the server.

export const OPTIONS = {
  gender: ["Male", "Female", "Other"],
  occ: ["Salaried (private)", "Salaried (government)", "Business owner", "Freelancer", "Student", "Homemaker", "Retired", "Other"],
  src: ["Salary", "Business income", "Savings", "Family support", "Inheritance", "Sale of property", "Freelance income", "Other"],
  inc: ["Under Rs 50,000", "Rs 50,000 – 150,000", "Rs 150,000 – 500,000", "Over Rs 500,000"],
  exp: ["Under Rs 100,000", "Rs 100,000 – 500,000", "Rs 500,000 – 2,000,000", "Over Rs 2,000,000"],
} as const;

export type Personal = { fullName: string; father: string; cnic: string; dob: string; expiry: string; gender: string; addr: string; city: string };
export type Financial = { occ: string; src: string; inc: string; exp: string; pep: "Yes" | "No"; own: true };
type Result<T> = { ok: true; value: T } | { ok: false; field: string; error: string };

const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + "T00:00:00Z"));

// Today's date in Pakistan, as YYYY-MM-DD.
export function todayPk(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
}

export function ageOn(dob: string, today: string): number {
  const [by, bm, bd] = dob.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}

export function validatePersonal(d: Record<string, unknown>, today = todayPk()): Result<Personal> {
  const v: Personal = {
    fullName: str(d.fullName, 80), father: str(d.father, 80), cnic: str(d.cnic, 15), dob: str(d.dob, 10),
    expiry: str(d.expiry, 10), gender: str(d.gender, 10), addr: str(d.addr, 200), city: str(d.city, 60),
  };
  if (v.fullName.split(" ").length < 2 || !/^[A-Za-z .'-]+$/.test(v.fullName))
    return { ok: false, field: "kName", error: "Full name in English letters, first and last." };
  if (v.father.length < 3) return { ok: false, field: "kFather", error: "Required." };
  if (!/^\d{5}-\d{7}-\d$/.test(v.cnic)) return { ok: false, field: "kCnic", error: "13 digits, like 35202-1234567-1." };
  if (!isDate(v.dob) || ageOn(v.dob, today) < 18 || ageOn(v.dob, today) > 120)
    return { ok: false, field: "kDob", error: "You must be 18 or older." };
  if (!isDate(v.expiry) || v.expiry <= today)
    return { ok: false, field: "kIssue", error: "Your CNIC has expired — renew it with NADRA first." };
  if (!(OPTIONS.gender as readonly string[]).includes(v.gender)) return { ok: false, field: "kGender", error: "Required." };
  if (v.addr.length < 8) return { ok: false, field: "kAddr", error: "Enter your full address." };
  if (v.city.length < 2) return { ok: false, field: "kCity", error: "Required." };
  return { ok: true, value: v };
}

export function validateFinancial(d: Record<string, unknown>): Result<Financial> {
  for (const [key, field] of [["occ", "kOcc"], ["src", "kSrc"], ["inc", "kInc"], ["exp", "kExp"]] as const) {
    if (!(OPTIONS[key] as readonly string[]).includes(str(d[key]))) return { ok: false, field, error: "Required." };
  }
  if (d.pep !== "Yes" && d.pep !== "No") return { ok: false, field: "kPep", error: "Please answer." };
  if (d.own !== true) return { ok: false, field: "kOwn", error: "Required to continue." };
  return { ok: true, value: { occ: str(d.occ), src: str(d.src), inc: str(d.inc), exp: str(d.exp), pep: d.pep, own: true } };
}

export const DOC_KINDS = { kFront: "cnic_front", kBack: "cnic_back", selfie: "selfie" } as const;
export type DocKind = (typeof DOC_KINDS)[keyof typeof DOC_KINDS];

// File type from its first bytes, never from the name or the browser's claim.
export function sniffType(buf: Uint8Array): "image/jpeg" | "image/png" | "application/pdf" | null {
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return "application/pdf";
  return null;
}
