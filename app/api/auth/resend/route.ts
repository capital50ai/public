import { isLive } from "@/lib/backend";
import { authMessage, TOO_MANY_CODES } from "@/lib/auth-errors";
import { clientIp, fail, readJson } from "@/lib/request";
import { withinLimit } from "@/lib/security";
import { createClient } from "@/lib/supabase/server";
import { normalizePkPhone } from "@/lib/validate";

export async function POST(req: Request) {
  if (!isLive()) return Response.json({ preview: true });
  const body = await readJson(req);
  const phone = normalizePkPhone(body.phone);
  if (!phone) return fail("Enter a Pakistani mobile number.");
  if (!(await withinLimit(`otp:phone:${phone}`, 3, 3600)) || !(await withinLimit(`otp:ip:${clientIp(req)}`, 10, 3600)))
    return fail(TOO_MANY_CODES, 429);

  const supabase = await createClient();
  const { error } =
    body.flow === "reset" || body.flow === "login"
      ? await supabase.auth.signInWithOtp({ phone, options: { shouldCreateUser: false } })
      : await supabase.auth.resend({ type: "sms", phone });
  // An unknown number gets the same answer as a known one.
  if (error && error.status === 429) return fail(authMessage(error), 429);
  if (error && body.flow === "signup") return fail(authMessage(error));
  return Response.json({ ok: true });
}
