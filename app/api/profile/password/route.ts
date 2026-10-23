import { isLive } from "@/lib/backend";
import { authMessage, TOO_MANY } from "@/lib/auth-errors";
import { clientIp, fail, readJson } from "@/lib/request";
import { audit, withinLimit } from "@/lib/security";
import { createPublicClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { passwordStrongEnough } from "@/lib/validate";

// Change password: current password + SMS code + a strong new password. Other devices are logged out.
export async function POST(req: Request) {
  if (!isLive()) return Response.json({ preview: true });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.phone) return fail("Please log in again.", 401);
  if (!(await withinLimit(`password-change:${user.id}`, 5, 3600))) return fail(TOO_MANY, 429);
  const body = await readJson(req);
  if (!passwordStrongEnough(body.password)) return fail("Use 8+ characters with a mix of uppercase, numbers or symbols.", 400, "cp1");
  if (body.password === body.current) return fail("Choose a password you haven't used here.", 400, "cp1");
  const phone = `+${user.phone.replace(/^\+/, "")}`;

  // Check the current password on a separate, stateless client so this session is untouched.
  const check = createPublicClient();
  const { error: pErr } = await check.auth.signInWithPassword({ phone, password: String(body.current ?? "") });
  if (pErr) return fail("Your current password is wrong.", 400, "cp0");
  await check.auth.signOut({ scope: "local" });

  const code = String(body.code ?? "").replace(/\D/g, "");
  if (code.length !== 6) return fail("Enter the 6-digit code sent to your phone.");
  const { data: v, error: vErr } = await supabase.auth.verifyOtp({ phone, token: code, type: "sms" });
  if (vErr || v.user?.id !== user.id) return fail(authMessage(vErr ?? { code: "otp_expired" }), 400);

  const { error } = await supabase.auth.updateUser({ password: body.password as string });
  if (error) return fail(authMessage(error), 400, "cp1");
  await supabase.auth.signOut({ scope: "others" });
  await audit({ actorId: user.id, action: "auth.password_changed", entity: "auth.users", entityId: user.id, after: { others_logged_out: true }, ip: clientIp(req) });
  return Response.json({ ok: true });
}
