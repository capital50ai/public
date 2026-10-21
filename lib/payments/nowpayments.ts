import { createHmac, timingSafeEqual } from "node:crypto";

export const nowpaymentsBase = (mode: "sandbox" | "live") =>
  process.env.NOWPAYMENTS_API_URL || (mode === "live" ? "https://api.nowpayments.io/v1" : "https://api-sandbox.nowpayments.io/v1");

// Keys sorted at every level, as NOWPayments does before signing.
function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === "object")
    return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sortDeep((v as Record<string, unknown>)[k])]));
  return v;
}

// x-nowpayments-sig = HMAC-SHA512(IPN secret, JSON of the body with sorted keys), hex.
export function nowpaymentsSignature(body: unknown, secret: string): string {
  return createHmac("sha512", secret).update(JSON.stringify(sortDeep(body))).digest("hex");
}

export function nowpaymentsVerify(body: unknown, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = nowpaymentsSignature(body, secret);
  return signature.length === expected.length && timingSafeEqual(Buffer.from(signature.toLowerCase()), Buffer.from(expected));
}

export async function nowpaymentsInvoice(o: {
  mode: "sandbox" | "live"; apiKey: string; orderId: string; usd: number;
  ipnUrl: string; successUrl: string; cancelUrl: string;
}): Promise<{ id: string; invoice_url: string }> {
  const r = await fetch(`${nowpaymentsBase(o.mode)}/invoice`, {
    method: "POST",
    headers: { "x-api-key": o.apiKey, "content-type": "application/json" },
    body: JSON.stringify({
      price_amount: o.usd, price_currency: "usd", pay_currency: "usdttrc20", order_id: o.orderId,
      order_description: "Capital 50 AI deposit", ipn_callback_url: o.ipnUrl,
      success_url: o.successUrl, cancel_url: o.cancelUrl, is_fixed_rate: true,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.invoice_url) throw new Error(`NOWPayments invoice failed: ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
  return { id: String(j.id), invoice_url: String(j.invoice_url) };
}
