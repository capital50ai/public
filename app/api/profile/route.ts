import { isLive } from "@/lib/backend";
import { clientIp, fail, readJson } from "@/lib/request";
import { audit, withinLimit } from "@/lib/security";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { cleanFullName, normalizeEmail } from "@/lib/validate";
import { checkOwnCode, sendOwnCode } from "@/lib/otp";

// Edit personal details. The mobile number is the login and can't change here; the name locks once
// identity verification is submitted (it must match the CNIC).
export async function POST(req: Request) {
  if (!isLive()) return Response.json({ preview: true });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return fail("Please log in again.", 401);
  if (!(await withinLimit(`profile:${user.id}`, 20, 86400))) return fail("Too many changes today. Try again tomorrow.", 429);
  const body = await readJson(req);
  const admin = createAdminClient();
  const [{ data: p }, { data: kyc }] = await Promise.all([
    admin.from("profiles").select("full_name, email, city").eq("user_id", user.id).single(),
    admin.from("kyc_applications").select("status").eq("user_id", user.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!p) return fail("Please log in again.", 401);
  const update: Record<string, string | null> = {};

  const locked = kyc?.status === "review" || kyc?.status === "verified";
  if (typeof body.name === "string" && body.name.trim() !== p.full_name) {
    if (locked) return fail("Your name is locked to your CNIC. Contact support to change it.", 400, "pN");
    const name = cleanFullName(body.name);
    if (!name) return fail("Enter your full name (first and last), using letters only.", 400, "pN");
    update.full_name = name;
  }
  if (typeof body.email === "string" && body.email.trim().toLowerCase() !== (p.email ?? "")) {
    const email = normalizeEmail(body.email);
    if (!email) return fail("Enter a valid email address.", 400, "pEm");
    const { data: taken } = await admin.from("profiles").select("user_id").ilike("email", email).neq("user_id", user.id).maybeSingle();
    if (taken) return fail("This email is already used by another account.", 409, "pEm");
    update.email = email;
  }
  if (typeof body.city === "string") {
    const city = body.city.trim().replace(/\s+/g, " ").slice(0, 40);
    if (city && !/^[A-Za-z][A-Za-z .'-]{1,39}$/.test(city)) return fail("Enter a city name.", 400, "pCi");
    if (city !== (p.city ?? "")) update.city = city || null;
  }
  if (!Object.keys(update).length) return Response.json({ ok: true });
  // A new email can be used to log in, so it needs an SMS code like other sensitive changes.
  if (update.email) {
    if (body.code == null) {
      const r = await sendOwnCode(supabase, user, req);
      return "error" in r ? fail(r.error, r.status) : Response.json({ otp: true, to: r.to });
    }
    const codeErr = await checkOwnCode(supabase, user, body.code);
    if (codeErr) return fail(codeErr, 400);
  }
  const { error } = await admin.from("profiles").update(update).eq("user_id", user.id);
  if (error) {
    console.error("profile update failed", error.message);
    return fail("Couldn't save. Please try again.", 500);
  }
  await audit({ actorId: user.id, action: "profile.update", entity: "profiles", entityId: user.id, after: { fields: Object.keys(update) }, ip: clientIp(req) });
  return Response.json({ ok: true });
}
