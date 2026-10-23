import { isLive } from "@/lib/backend";
import { fail, readJson } from "@/lib/request";
import { withinLimit } from "@/lib/security";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Investor reply on their own ticket (ticket_reply checks ownership).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isLive()) return Response.json({ preview: true });
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return fail("Please log in again.", 401);
  if (!(await withinLimit(`ticket-reply:${user.id}`, 30, 86400))) return fail("Too many messages today. Please wait for our reply.", 429);
  const message = String((await readJson(req)).message ?? "").trim().slice(0, 1500);
  if (!message) return fail("Write a message.");
  const { error } = await createAdminClient().rpc("ticket_reply", { p_ticket: id, p_author: user.id, p_staff: false, p_body: message });
  if (error) return fail(error.message === "Ticket not found" ? error.message : "Couldn't send. Please try again.", 400);
  return Response.json({ ok: true });
}
