import { isLive } from "@/lib/backend";
import { authMessage, TOO_MANY_CODES } from "@/lib/auth-errors";
import { clientIp, fail, readJson } from "@/lib/request";
import { withinLimit } from "@/lib/security";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { cleanFullName, cleanReferralCode, normalizeEmail, normalizePkPhone, passwordStrongEnough } from "@/lib/validate";

export async function POST(req: Request) {
  if (!isLive()) return Response.json({ preview: true });
  const body = await readJson(req);
  const ip = clientIp(req);

  const fullName = cleanFullName(body.name);
  if (!fullName) return fail("Enter your full name (first and last), using letters only.", 400, "name");
  const phone = normalizePkPhone(body.phone);
  if (!phone) return fail("Enter a Pakistani mobile number, like 300 1234567.", 400, "phone");
  const email = normalizeEmail(body.email);
  if (!email) return fail("Enter a valid email address.", 400, "email");
  if (!passwordStrongEnough(body.password))
    return fail("Use 8+ characters with a mix of uppercase, numbers or symbols.", 400, "password");
  if (body.terms !== true) return fail("Please confirm you understand the risks.", 400, "terms");

  const admin = createAdminClient();
  const { data: emailOwner } = await admin.from("profiles").select("phone").eq("email", email).maybeSingle();
  if (emailOwner && emailOwner.phone !== phone)
    return fail("This email is already used by another account.", 409, "email");

  // A number that started sign-up but never entered its code is cleared so the new details apply.
  const { data: existing } = await admin.from("profiles").select("user_id").eq("phone", phone).maybeSingle();
  if (existing) {
    const { data: u } = await admin.auth.admin.getUserById(existing.user_id);
    if (u.user?.phone_confirmed_at)
      return fail("An account with this number already exists. Log in instead.", 409, "phone");
  }

  // Counted only when a code is about to be sent, so fixing a typo above never uses up the allowance.
  if (!(await withinLimit(`otp:phone:${phone}`, 3, 3600)) || !(await withinLimit(`otp:ip:${ip}`, 10, 3600)))
    return fail(TOO_MANY_CODES, 429, "phone");
  if (existing) await admin.auth.admin.deleteUser(existing.user_id);

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    phone,
    password: body.password as string,
    options: {
      data: {
        full_name: fullName,
        email,
        ref: cleanReferralCode(body.ref) ?? "",
        risk_ack_at: new Date().toISOString(),
      },
    },
  });
  if (error) return fail(authMessage(error), error.status === 429 ? 429 : 400, "phone");
  return Response.json({ ok: true });
}
