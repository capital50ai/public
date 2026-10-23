import { isLive } from "@/lib/backend";
import { dataKeyConfigured, encrypt } from "@/lib/crypto";
import { clientIp, fail, readJson } from "@/lib/request";
import { audit, withinLimit } from "@/lib/security";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const RELATIONS = ["Spouse", "Father", "Mother", "Son", "Daughter", "Brother", "Sister", "Other"];

// Save the nominee. The CNIC is encrypted; the browser only ever gets back a masked hint.
export async function POST(req: Request) {
  if (!isLive()) return Response.json({ preview: true });
  if (!dataKeyConfigured()) return fail("This isn't available yet. Please try again later.", 503);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return fail("Please log in again.", 401);
  if (!(await withinLimit(`nominee:${user.id}`, 10, 86400))) return fail("Too many changes today. Try again tomorrow.", 429);
  const body = await readJson(req);
  const name = String(body.name ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
  if (!/^[A-Za-z][A-Za-z .'-]+ [A-Za-z .'-]+$/.test(name)) return fail("Enter the nominee's full name.", 400, "nN");
  const rel = String(body.rel ?? "");
  if (!RELATIONS.includes(rel)) return fail("Choose the relationship.", 400, "nR");
  const cnic = String(body.cnic ?? "").replace(/\D/g, "");
  if (!/^\d{13}$/.test(cnic)) return fail("Enter the 13-digit CNIC.", 400, "nC");
  const hint = `${cnic.slice(0, 5)}-•••••••-${cnic.slice(-1)}`;
  const { error } = await createAdminClient().from("nominees").upsert({
    user_id: user.id, full_name: name, relation: rel, cnic_enc: encrypt(cnic), cnic_hint: hint, updated_at: new Date().toISOString(),
  });
  if (error) {
    console.error("nominee save failed", error.message);
    return fail("Couldn't save. Please try again.", 500);
  }
  await audit({ actorId: user.id, action: "profile.nominee", entity: "nominees", entityId: user.id, after: { relation: rel }, ip: clientIp(req) });
  return Response.json({ nominee: { name, rel, hint } });
}
