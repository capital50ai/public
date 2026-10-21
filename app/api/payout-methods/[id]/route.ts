import { isLive } from "@/lib/backend";
import { clientIp, fail } from "@/lib/request";
import { audit } from "@/lib/security";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Removing a method only switches it off; history keeps pointing at it.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isLive()) return Response.json({ preview: true });
  const { id } = await params;
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user) return fail("Please log in again.", 401);
  const admin = createAdminClient();
  const { data: open } = await admin.from("withdrawals").select("id").eq("payout_method_id", id).in("status", ["requested", "approved"]).limit(1);
  if (open?.length) return fail("A withdrawal to this account is in progress. Remove it after that's paid.", 409);
  const { data, error } = await admin.from("payout_methods").update({ disabled_at: new Date().toISOString() })
    .eq("id", id).eq("user_id", user.id).is("disabled_at", null).select("account_hint").maybeSingle();
  if (error || !data) return fail("Payout method not found.", 404);
  await audit({ actorId: user.id, action: "payout_method.remove", entity: "payout_methods", entityId: id, ip: clientIp(req), after: { account: data.account_hint } });
  return Response.json({ ok: true });
}
