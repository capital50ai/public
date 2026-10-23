import { isLive } from "@/lib/backend";
import { fail, readJson } from "@/lib/request";
import { withinLimit } from "@/lib/security";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { TICKET_CATEGORIES, TICKET_COLS, ticketToClient } from "@/lib/tickets";

// Open a support ticket.
export async function POST(req: Request) {
  if (!isLive()) return Response.json({ preview: true });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return fail("Please log in again.", 401);
  if (!(await withinLimit(`ticket:${user.id}`, 5, 86400))) return fail("You can open 5 tickets a day. Reply to an existing ticket instead.", 429);
  const body = await readJson(req);
  const category = String(body.category ?? "");
  const subject = String(body.subject ?? "").trim().slice(0, 80);
  const message = String(body.message ?? "").trim().slice(0, 1500);
  if (!TICKET_CATEGORIES.includes(category)) return fail("Choose a category.");
  if (subject.length < 3 || message.length < 10) return fail("Add a subject and a few details.");
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("open_ticket", { p_user: user.id, p_category: category, p_subject: subject, p_body: message });
  if (error) return fail(error.message.startsWith("You have 5 open") ? error.message : "Couldn't send the ticket. Please try again.", 400);
  const { data: t } = await admin.from("tickets").select(TICKET_COLS).eq("id", (data as { id: string }).id).single();
  return Response.json({ ticket: ticketToClient(t as Parameters<typeof ticketToClient>[0]) });
}
