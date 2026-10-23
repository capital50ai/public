import { must, staffAction, text } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";

// Freeze/unfreeze an investor or block/unblock them as an affiliate (set_account_flag checks the role).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return staffAction(req, ["owner", "compliance"], `/admin/users/${id}`, async (staff, form) => {
    const flag = text(form, "flag", 20);
    if (flag !== "freeze" && flag !== "block_affiliate") throw new Error("Unknown action");
    const on = form.get("on") === "1";
    must(await createAdminClient().rpc("set_account_flag", { p_user: id, p_staff: staff.userId, p_flag: flag, p_on: on, p_reason: text(form, "reason") }));
    return flag === "freeze" ? (on ? "Account frozen." : "Account unfrozen.") : on ? "Affiliate blocked." : "Affiliate unblocked.";
  });
}
