import { createAdminClient } from "@/lib/supabase/admin";
import { nowpaymentsConfig } from "@/lib/payments/config";
import { nowpaymentsVerify } from "@/lib/payments/nowpayments";
import { logPaymentEvent } from "@/lib/payments/deposits";

// NOWPayments IPN. Signature-checked; the only way a USDT deposit gets credited.
export async function POST(req: Request) {
  const np = nowpaymentsConfig();
  if (!np) return new Response("Not configured", { status: 404 });
  const raw = await req.text();
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { return new Response("Bad request", { status: 400 }); }

  const signatureOk = nowpaymentsVerify(body, req.headers.get("x-nowpayments-sig"), np.ipnSecret);
  const admin = createAdminClient();
  const { data: dep } = await admin.from("deposits").select("id, amount, method, status, meta")
    .eq("reference", String(body.order_id ?? "")).maybeSingle();
  const log = (outcome: string) => logPaymentEvent({ provider: "nowpayments", depositId: dep?.id, signatureOk, outcome, payload: body });

  if (!signatureOk) { await log("rejected: bad signature"); return new Response("Invalid signature", { status: 401 }); }
  if (!dep || dep.method !== "usdt") { await log("ignored: unknown order"); return Response.json({ ok: true }); }

  const status = String(body.payment_status ?? "");
  const meta = dep.meta as { usd?: number };
  const priceOk = String(body.price_currency).toLowerCase() === "usd" && Math.abs(Number(body.price_amount) - Number(meta.usd)) < 0.005;

  if (status === "finished") {
    if (!priceOk) { await log("held: amount does not match the invoice"); return Response.json({ ok: true }); }
    const { data, error } = await admin.rpc("credit_deposit", {
      p_deposit: dep.id, p_actor: null, p_source: "nowpayments_ipn", p_provider_ref: `NP:${body.payment_id}`,
    });
    await log(error ? `error: ${error.message}` : (data as { already?: boolean }).already ? "duplicate: already credited" : "credited");
  } else if (status === "failed" || status === "expired") {
    await admin.rpc("close_deposit", { p_deposit: dep.id, p_status: status, p_actor: null, p_note: `NOWPayments: ${status}` });
    await log(status);
  } else if (status === "partially_paid") {
    await admin.from("deposits").update({ status_note: "Partially paid: staff review needed" }).eq("id", dep.id);
    await log("held: partially paid");
  } else {
    await log(`noted: ${status}`);
  }
  return Response.json({ ok: true });
}
