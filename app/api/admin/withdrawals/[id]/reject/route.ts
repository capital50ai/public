import { createAdminClient } from "@/lib/supabase/admin";
import { requireStaffApi, sameOrigin } from "@/lib/staff";

// Rejects a withdrawal; the reason is shown to the investor.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  const staff = await requireStaffApi(["owner", "finance"]);
  if (!staff) return new Response("Forbidden", { status: 403 });
  const form = await req.formData();
  const { error } = await createAdminClient().rpc(
    "reject_withdrawal",
    { p_id: id, p_staff: staff.userId, p_reason: String(form.get("reason") ?? "").slice(0, 300) },
  );
  const q = error ? `error=${encodeURIComponent(error.message)}` : `done=${encodeURIComponent("rejected")}`;
  return Response.redirect(new URL(`/admin/withdrawals?${q}`, req.url), 303);
}
