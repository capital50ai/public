import { isLive } from "@/lib/backend";
import { clientIp, fail, readJson } from "@/lib/request";
import { audit } from "@/lib/security";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { validateFinancial, validatePersonal } from "@/lib/kyc";
import { cnicHash, documentKinds, kycState, latestApplication } from "@/lib/kyc-server";

export async function GET() {
  if (!isLive()) return Response.json({ preview: true });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return fail("Please log in again.", 401);
  return Response.json(await kycState(supabase));
}

// Saves one step of the KYC form: { step: "personal" | "financial" | "submit", data, declaration }.
export async function POST(req: Request) {
  if (!isLive()) return Response.json({ preview: true });
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user) return fail("Please log in again.", 401);
  const body = await readJson(req);
  const data = (body.data && typeof body.data === "object" ? body.data : {}) as Record<string, unknown>;
  const admin = createAdminClient();

  let app = await latestApplication(user.id);
  if (app?.status === "verified") return fail("You're already verified.", 409);
  if (app?.status === "review") return fail("Your details are already under review.", 409);

  if (body.step === "personal") {
    const v = validatePersonal(data);
    if (!v.ok) return fail(v.error, 400, v.field);
    const hash = cnicHash(v.value.cnic);
    const { data: taken } = await admin
      .from("kyc_applications").select("user_id").eq("cnic_hash", hash).in("status", ["review", "verified"])
      .neq("user_id", user.id).limit(1);
    if (taken?.length) return fail("This CNIC is already registered to another account. Contact support.", 409, "kCnic");

    if (!app || app.status === "rejected") {
      const { data: created, error } = await admin
        .from("kyc_applications").insert({ user_id: user.id, personal: v.value, cnic_hash: hash })
        .select("id, status, personal, financial, rejection_reason, submitted_at").single();
      if (error) return fail("We couldn't save your details. Please try again.", 500);
      app = created as typeof app;
    } else {
      const { error } = await admin.from("kyc_applications").update({ personal: v.value, cnic_hash: hash }).eq("id", app.id);
      if (error) return fail("We couldn't save your details. Please try again.", 500);
    }
    return Response.json({ ok: true });
  }

  if (!app || app.status !== "draft") return fail("Start with your personal details.", 409);

  if (body.step === "financial") {
    const v = validateFinancial(data);
    if (!v.ok) return fail(v.error, 400, v.field);
    const { error } = await admin
      .from("kyc_applications").update({ financial: v.value, pep: v.value.pep === "Yes", edd: v.value.pep === "Yes" }).eq("id", app.id);
    if (error) return fail("We couldn't save your details. Please try again.", 500);
    return Response.json({ ok: true });
  }

  if (body.step === "submit") {
    if (body.declaration !== true) return fail("Please confirm to submit.", 400, "kDecl");
    if (!validatePersonal(app.personal).ok || !validateFinancial(app.financial).ok)
      return fail("Some details are missing. Go back and check each step.", 400);
    const kinds = await documentKinds(app.id);
    if (!["cnic_front", "cnic_back", "selfie"].every((k) => kinds.has(k)))
      return fail("Upload both sides of your CNIC and a selfie first.", 400);
    const { error } = await admin
      .from("kyc_applications").update({ status: "review", submitted_at: new Date().toISOString() })
      .eq("id", app.id).eq("status", "draft");
    if (error) {
      const dup = error.code === "23505";
      return fail(dup ? "This CNIC is already registered to another account. Contact support." : "We couldn't submit. Please try again.", dup ? 409 : 500);
    }
    await audit({ actorId: user.id, action: "kyc.submit", entity: "kyc_applications", entityId: app.id, ip: clientIp(req) });
    return Response.json({ ok: true });
  }

  return fail("Unknown step.");
}
