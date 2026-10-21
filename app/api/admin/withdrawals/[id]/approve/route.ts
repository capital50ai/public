import { createAdminClient } from "@/lib/supabase/admin";
import { requireStaffApi, sameOrigin } from "@/lib/staff";

// Approves a withdrawal. Above the threshold a second, different staff member must approve too.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  const staff = await requireStaffApi(["owner", "finance"]);
  if (!staff) return new Response("Forbidden", { status: 403 });
  const { data, error } = await createAdminClient().rpc(
    "approve_withdrawal",
    { p_id: id, p_staff: staff.userId },
  );
  const q = error ? `error=${encodeURIComponent(error.message)}` : `done=${encodeURIComponent((data as { status: string }).status === "approved" ? "approved" : "first-approval")}`;
  return Response.redirect(new URL(`/admin/withdrawals?${q}`, req.url), 303);
}
