import { isLive } from "@/lib/backend";
import { authMessage, TOO_MANY_CODES } from "@/lib/auth-errors";
import { clientIp, fail } from "@/lib/request";
import { withinLimit } from "@/lib/security";
import { createClient } from "@/lib/supabase/server";

// Sends the SMS code that confirms a withdrawal to the investor's own number.
export async function POST(req: Request) {
  if (!isLive()) return Response.json({ preview: true });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.phone) return fail("Please log in again.", 401);
  const phone = `+${user.phone.replace(/^\+/, "")}`;
  if (!(await withinLimit(`otp:phone:${phone}`, 3, 3600)) || !(await withinLimit(`otp:ip:${clientIp(req)}`, 10, 3600)))
    return fail(TOO_MANY_CODES, 429);
  const { error } = await supabase.auth.signInWithOtp({ phone, options: { shouldCreateUser: false } });
  if (error) return fail(authMessage(error), error.status === 429 ? 429 : 400);
  return Response.json({ ok: true, to: `+92 ${phone.slice(3, 6)} ••••${phone.slice(-3)}` });
}
