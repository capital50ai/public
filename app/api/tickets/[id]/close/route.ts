import { isLive } from "@/lib/backend";
import { fail } from "@/lib/request";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isLive()) return Response.json({ preview: true });
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return fail("Please log in again.", 401);
  const { error } = await createAdminClient().rpc("ticket_close", { p_ticket: id, p_actor: user.id, p_staff: false });
  if (error) return fail("Ticket not found.", 404);
  return Response.json({ ok: true });
}
