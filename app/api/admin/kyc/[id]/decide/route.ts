import { createAdminClient } from "@/lib/supabase/admin";
import { requireStaffApi, sameOrigin } from "@/lib/staff";

// Form post from the review page: approve, or reject with a reason.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const back = (q: string) => Response.redirect(new URL(`/admin/kyc/${id}?${q}`, req.url), 303);
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  const staff = await requireStaffApi(["owner", "compliance"]);
  if (!staff) return new Response("Forbidden", { status: 403 });

  const form = await req.formData();
  const approve = form.get("decision") === "approve";
  const reason = String(form.get("reason") ?? "").trim().slice(0, 500);
  const { error } = await createAdminClient().rpc("kyc_decide", {
    p_application: id, p_staff: staff.userId, p_approve: approve, p_reason: reason || null,
  });
  if (error) return back("error=" + encodeURIComponent(error.message));
  return Response.redirect(new URL(`/admin/kyc?done=${approve ? "approved" : "rejected"}`, req.url), 303);
}
