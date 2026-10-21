import { createAdminClient } from "@/lib/supabase/admin";
import { requireStaffApi, sameOrigin } from "@/lib/staff";

// Marks a pending deposit failed (e.g. no matching transfer arrived). Reason required.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  const staff = await requireStaffApi(["owner", "finance"]);
  if (!staff) return new Response("Forbidden", { status: 403 });
  const reason = String((await req.formData()).get("reason") ?? "").trim().slice(0, 300);
  if (reason.length < 5) return Response.redirect(new URL("/admin/deposits?error=" + encodeURIComponent("Give a reason (5+ characters)."), req.url), 303);
  const { error } = await createAdminClient().rpc("close_deposit", { p_deposit: id, p_status: "failed", p_actor: staff.userId, p_note: reason });
  const q = error ? `error=${encodeURIComponent(error.message)}` : "done=rejected";
  return Response.redirect(new URL(`/admin/deposits?${q}`, req.url), 303);
}
