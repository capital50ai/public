import { isLive } from "@/lib/backend";
import { TOO_MANY } from "@/lib/auth-errors";
import { clientIp, fail, readJson } from "@/lib/request";
import { audit, withinLimit } from "@/lib/security";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { normalizeEmail } from "@/lib/validate";

export async function POST(req: Request) {
  if (!isLive()) return fail("Not available.", 404);
  const body = await readJson(req);
  const email = normalizeEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) return fail("Enter your email and password.");
  const ip = clientIp(req);
  if (!(await withinLimit(`staff-login:${email}`, 5, 900)) || !(await withinLimit(`staff-login-ip:${ip}`, 20, 900)))
    return fail(TOO_MANY, 429);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) return fail("Wrong email or password.", 401);
  const { data: staff } = await createAdminClient()
    .from("staff_members").select("role").eq("user_id", data.user.id).eq("active", true).maybeSingle();
  if (!staff) {
    await supabase.auth.signOut();
    return fail("Wrong email or password.", 401);
  }
  await audit({ actorId: data.user.id, action: "staff.login_password", entity: "auth.users", entityId: data.user.id, ip });
  return Response.json({ ok: true, next: "/admin/mfa" });
}
