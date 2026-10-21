import { createAdminClient } from "@/lib/supabase/admin";
import { jazzcashConfig } from "@/lib/payments/config";
import { jazzcashHash, jazzcashVerify } from "@/lib/payments/jazzcash";
import { logPaymentEvent } from "@/lib/payments/deposits";

const PENDING_CODES = new Set(["124", "157"]);

async function readFields(req: Request): Promise<Record<string, string>> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) return Object.fromEntries(Object.entries(await req.json()).map(([k, v]) => [k, String(v ?? "")]));
  return Object.fromEntries([...(await req.formData()).entries()].map(([k, v]) => [k, String(v)]));
}

// JazzCash IPN (server to server). Signature-checked; the only way a JazzCash deposit gets credited.
export async function POST(req: Request) {
  const jc = jazzcashConfig();
  if (!jc) return new Response("Not configured", { status: 404 });
  const f = await readFields(req).catch(() => ({} as Record<string, string>));
  const signatureOk = jazzcashVerify(f, jc.salt);
  const admin = createAdminClient();
  const { data: dep } = await admin.from("deposits").select("id, amount, method").eq("reference", f.pp_TxnRefNo ?? "").maybeSingle();
  const log = (outcome: string) => logPaymentEvent({ provider: "jazzcash", depositId: dep?.id, signatureOk, outcome, payload: { ...f, pp_Password: undefined } });
  const reply = (code: string, message: string, status = 200) => {
    const r: Record<string, string> = { pp_ResponseCode: code, pp_ResponseMessage: message };
    return Response.json({ ...r, pp_SecureHash: jazzcashHash(r, jc.salt) }, { status });
  };

  if (!signatureOk) { await log("rejected: bad signature"); return reply("999", "Invalid secure hash", 401); }
  if (!dep || dep.method !== "jazzcash" || f.pp_MerchantID !== jc.merchantId) { await log("ignored: unknown order"); return reply("000", "IPN received"); }

  const code = f.pp_ResponseCode;
  if (code === "000") {
    if (f.pp_Amount !== String(Math.round(Number(dep.amount) * 100))) { await log("held: amount does not match"); return reply("000", "IPN received"); }
    const { data, error } = await admin.rpc("credit_deposit", {
      p_deposit: dep.id, p_actor: null, p_source: "jazzcash_ipn", p_provider_ref: `JC:${f.pp_RetreivalReferenceNo || f.pp_TxnRefNo}`,
    });
    await log(error ? `error: ${error.message}` : (data as { already?: boolean }).already ? "duplicate: already credited" : "credited");
  } else if (PENDING_CODES.has(code)) {
    await log(`pending: ${code} ${f.pp_ResponseMessage ?? ""}`);
  } else {
    await admin.rpc("close_deposit", { p_deposit: dep.id, p_status: "failed", p_actor: null, p_note: `JazzCash ${code}: ${f.pp_ResponseMessage ?? ""}`.slice(0, 200) });
    await log(`failed: ${code}`);
  }
  return reply("000", "IPN received");
}
