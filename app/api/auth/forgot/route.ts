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
  if (!phone) return fail("Enter a Pakistani mobile number.", 400, "phone");
  if (!(await withinLimit(`otp:phone:${phone}`, 3, 3600)) || !(await withinLimit(`otp:ip:${clientIp(req)}`, 10, 3600)))
    return fail(TOO_MANY_CODES, 429, "phone");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({ phone, options: { shouldCreateUser: false } });
  // Same response whether or not the number has an account, so numbers can't be probed.
  if (error && error.status === 429) return fail(authMessage(error), 429, "phone");
  return Response.json({ ok: true });
}
