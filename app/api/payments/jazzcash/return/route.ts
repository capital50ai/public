import { jazzcashConfig } from "@/lib/payments/config";
import { jazzcashVerify } from "@/lib/payments/jazzcash";
import { logPaymentEvent } from "@/lib/payments/deposits";
import { createAdminClient } from "@/lib/supabase/admin";

// Where JazzCash sends the investor's browser back. It never credits anything (the IPN does);
// it only records what came back and returns the investor to their wallet.
export async function POST(req: Request) {
  const jc = jazzcashConfig();
  const form = await req.formData().catch(() => null);
  const f = Object.fromEntries([...(form?.entries() ?? [])].map(([k, v]) => [k, String(v)]));
  const signatureOk = !!jc && jazzcashVerify(f, jc.salt);
  const { data: dep } = await createAdminClient().from("deposits").select("id").eq("reference", f.pp_TxnRefNo ?? "").maybeSingle();
  await logPaymentEvent({ provider: "jazzcash", depositId: dep?.id, signatureOk, outcome: `return: ${f.pp_ResponseCode ?? "?"}`, payload: { ...f, pp_Password: undefined } });
  const result = signatureOk && f.pp_ResponseCode === "000" ? "processing" : "not-completed";
  return Response.redirect(new URL(`/dashboard.html?deposit=${result}#wallet`, req.url), 303);
}
