import "server-only";
import { randomInt } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export const METHODS = ["jazzcash", "easypaisa", "bank", "usdt"] as const;
export type Method = (typeof METHODS)[number];

const BANK_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

// Provider order reference: "C50" + 17 digits (JazzCash allows 20 alphanumerics).
export const providerReference = () => "C50" + Date.now().toString().slice(-11) + String(randomInt(0, 1e6)).padStart(6, "0");
// What an investor types into their bank transfer remarks.
export const bankReference = () => "C50-" + Array.from({ length: 6 }, () => BANK_ALPHABET[randomInt(0, BANK_ALPHABET.length)]).join("");

export async function bankAccount() {
  const { data } = await createAdminClient().from("app_settings").select("value").eq("key", "bank_account").maybeSingle();
  const v = (data?.value ?? {}) as { bank?: string; title?: string; iban?: string };
  return v.iban ? { bank: v.bank ?? "", title: v.title ?? "", iban: v.iban } : null;
}

// Next month's name: money paid now starts earning then (mirrors deposit_effective_ym in SQL).
export function effectiveLabel(now = new Date()): string {
  const [y, m] = now.toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" }).split("-").map(Number);
  return new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1)).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

export async function logPaymentEvent(e: { provider: string; depositId?: string | null; signatureOk: boolean; outcome: string; payload: unknown }) {
  const { error } = await createAdminClient().from("payment_events").insert({
    provider: e.provider, deposit_id: e.depositId ?? null, signature_ok: e.signatureOk, outcome: e.outcome, payload: e.payload ?? {},
  });
  if (error) console.error("payment event log failed", error.message);
}
