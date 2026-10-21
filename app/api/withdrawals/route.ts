import { isLive } from "@/lib/backend";
import { authMessage, TOO_MANY } from "@/lib/auth-errors";
import { moneyMessage } from "@/lib/money-errors";
import { clientIp, fail, readJson } from "@/lib/request";
import { withinLimit } from "@/lib/security";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Creates a withdrawal request after checking the SMS code. Staff approve and pay it in /admin.
export async function POST(req: Request) {
  if (!isLive()) return Response.json({ preview: true });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.phone) return fail("Please log in again.", 401);
  const body = await readJson(req);
  const code = String(body.code ?? "").replace(/\D/g, "");
  const amount = Number(body.amount);
  if (code.length !== 6) return fail("Enter the 6-digit code sent to your phone.");
  if (!Number.isFinite(amount)) return fail("Enter an amount.");
  if (!(await withinLimit(`wd-verify:${user.id}`, 5, 900))) return fail(TOO_MANY, 429);

  // The code proves the person holds the account's phone right now.
  const { data: v, error: vErr } = await supabase.auth.verifyOtp({ phone: `+${user.phone.replace(/^\+/, "")}`, token: code, type: "sms" });
  if (vErr || v.user?.id !== user.id) return fail(authMessage(vErr ?? { code: "otp_expired" }), 400);

  const { data: id, error } = await createAdminClient().rpc("request_withdrawal", {
    p_user: user.id, p_method: String(body.method_id ?? ""), p_amount: Math.round(amount * 100) / 100, p_otp_at: new Date().toISOString(),
  });
  if (error) return fail(moneyMessage(error, "Couldn't create the withdrawal. Please try again."), 400);
  console.info("withdrawal requested", id, clientIp(req));
  return Response.json({ ok: true, id });
}
