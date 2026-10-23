import { isLive } from "@/lib/backend";
import { fail } from "@/lib/request";
import { createClient } from "@/lib/supabase/server";

// The bell was opened: mark the signed-in investor's notifications read.
export async function POST() {
  if (!isLive()) return Response.json({ preview: true });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return fail("Please log in again.", 401);
  await supabase.rpc("mark_notifications_read");
  return Response.json({ ok: true });
}
