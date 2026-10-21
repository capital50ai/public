import { isLive } from "@/lib/backend";
import { moneyMessage } from "@/lib/money-errors";
import { fail } from "@/lib/request";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isLive()) return Response.json({ preview: true });
  const { id } = await params;
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user) return fail("Please log in again.", 401);
  const { error } = await createAdminClient().rpc("cancel_withdrawal", { p_user: user.id, p_id: id });
  if (error) return fail(moneyMessage(error), 400);
  return Response.json({ ok: true });
}
