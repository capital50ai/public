import { createAdminClient } from "@/lib/supabase/admin";
import { requireStaffApi, sameOrigin } from "@/lib/staff";

// One of the two staff confirmations a bank transfer needs. The second one credits it.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  const staff = await requireStaffApi(["owner", "finance"]);
  if (!staff) return new Response("Forbidden", { status: 403 });
  const form = await req.formData();
  const { data, error } = await createAdminClient().rpc("confirm_bank_deposit", {
    p_deposit: id, p_staff: staff.userId, p_bank_ref: String(form.get("bank_ref") ?? "").slice(0, 64),
  });
  const msg = error ? `error=${encodeURIComponent(error.message)}`
    : `done=${(data as { status: string }).status === "paid" ? "credited" : "first-confirmation"}`;
  return Response.redirect(new URL(`/admin/deposits?${msg}`, req.url), 303);
}
