import { isLive } from "@/lib/backend";
import { authMessage, TOO_MANY } from "@/lib/auth-errors";
import { clientIp, fail, readJson } from "@/lib/request";
import { audit, withinLimit } from "@/lib/security";
import { createClient } from "@/lib/supabase/server";
import { normalizePkPhone } from "@/lib/validate";
import { trustThisDevice } from "@/lib/devices";

export async function POST(req: Request) {
  if (!isLive()) return Response.json({ preview: true });
  const body = await readJson(req);
  const phone = normalizePkPhone(body.phone);
  const code = typeof body.code === "string" ? body.code : "";
  if (!phone || !/^\d{6}$/.test(code)) return fail("Enter the 6-digit code.");
  if (!(await withinLimit(`verify:phone:${phone}`, 10, 900))) return fail(TOO_MANY, 429);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ phone, token: code, type: "sms" });
  if (error || !data.user) return fail(authMessage(error ?? { code: "otp_expired" }), 400);

  await audit({
    actorId: data.user.id,
    action: body.flow === "reset" ? "auth.reset_code_verified" : body.flow === "login" ? "auth.login_new_device" : "auth.signup_verified",
    entity: "auth.users",
    entityId: data.user.id,
    ip: clientIp(req),
  });
  // This browser has now proved it holds the phone.
  await trustThisDevice(data.user.id, req.headers.get("user-agent"));
  return Response.json({ ok: true });
}
