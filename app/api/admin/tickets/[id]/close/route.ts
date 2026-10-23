import { must, staffAction } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return staffAction(req, ["owner", "compliance", "finance", "support"], `/admin/tickets/${id}`, async (staff) => {
    must(await createAdminClient().rpc("ticket_close", { p_ticket: id, p_actor: staff.userId, p_staff: true }));
    return "Ticket closed.";
  });
}
