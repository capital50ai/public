import { must, staffAction, text } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";

// Void a commission (abuse, duplicate account). Credited ones are reversed with a new ledger entry.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return staffAction(req, ["owner", "compliance", "finance"], "/admin/affiliates", async (staff, form) => {
    must(await createAdminClient().rpc("void_commission", { p_id: id, p_staff: staff.userId, p_reason: text(form, "reason") }));
    return "Commission voided.";
  });
}
