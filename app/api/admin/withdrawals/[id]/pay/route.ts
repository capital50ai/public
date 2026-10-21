import { createAdminClient } from "@/lib/supabase/admin";
import { requireStaffApi, sameOrigin } from "@/lib/staff";

// Records that the money was sent (transaction reference required). This is when it leaves the ledger.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  const staff = await requireStaffApi(["owner", "finance"]);
  if (!staff) return new Response("Forbidden", { status: 403 });
  const form = await req.formData();
  const { error } = await createAdminClient().rpc(
    "pay_withdrawal",
    { p_id: id, p_staff: staff.userId, p_tx_ref: String(form.get("tx_ref") ?? "").slice(0, 64) },
  );
  const q = error ? `error=${encodeURIComponent(error.message)}` : `done=${encodeURIComponent("paid")}`;
  return Response.redirect(new URL(`/admin/withdrawals?${q}`, req.url), 303);
}
