import { isLive } from "@/lib/backend";
import { authMessage, TOO_MANY } from "@/lib/auth-errors";
import { clientIp, fail, readJson } from "@/lib/request";
import { audit, withinLimit } from "@/lib/security";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { normalizeEmail, normalizePkPhone } from "@/lib/validate";

export async function POST(req: Request) {
  if (!isLive()) return Response.json({ preview: true });
  const body = await readJson(req);
  const ip = clientIp(req);
  const password = typeof body.password === "string" ? body.password : "";
  if (!password) return fail("Enter your password.", 400, "password");

  let phone: string | null;
  let limitKey: string;
  if (body.by === "email") {
    const email = normalizeEmail(body.email);
    if (!email) return fail("Enter a valid email address.", 400, "email");
    limitKey = `login:email:${email}`;
    if (!(await withinLimit(limitKey, 5, 900)) || !(await withinLimit(`login:ip:${ip}`, 20, 900)))
      return fail(TOO_MANY, 429);
    const { data } = await createAdminClient().from("profiles").select("phone").eq("email", email).maybeSingle();
    phone = data?.phone ?? null;
    if (!phone) return fail("Wrong email or password.", 401, "password");
  } else {
    phone = normalizePkPhone(body.phone);
    if (!phone) return fail("Enter a Pakistani mobile number, like 300 1234567.", 400, "phone");
    limitKey = `login:phone:${phone}`;
    if (!(await withinLimit(limitKey, 5, 900)) || !(await withinLimit(`login:ip:${ip}`, 20, 900)))
      return fail(TOO_MANY, 429);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ phone, password });
  if (error) {
    const msg = authMessage(error);
    const status = error.code === "invalid_credentials" ? 401 : 400;
    return fail(body.by === "email" && error.code === "invalid_credentials" ? "Wrong email or password." : msg, status, "password");
  }
  await audit({ actorId: data.user.id, action: "auth.login", entity: "auth.users", entityId: data.user.id, ip });
  return Response.json({ ok: true });
}
