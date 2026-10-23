import { must, staffAction, text } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return staffAction(req, ["owner", "compliance", "finance", "support"], `/admin/tickets/${id}`, async (staff, form) => {
    must(await createAdminClient().rpc("ticket_reply", { p_ticket: id, p_author: staff.userId, p_staff: true, p_body: text(form, "body", 1500) }));
    return "Reply sent.";
  });
}
