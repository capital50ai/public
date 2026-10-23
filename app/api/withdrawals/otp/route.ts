import { isLive } from "@/lib/backend";
import { sendOwnCode } from "@/lib/otp";
import { fail } from "@/lib/request";
import { createClient } from "@/lib/supabase/server";

// Sends the SMS code that confirms a withdrawal (or password change) to the investor's own number.
export async function POST(req: Request) {
  if (!isLive()) return Response.json({ preview: true });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.phone) return fail("Please log in again.", 401);
  const r = await sendOwnCode(supabase, user, req);
  if ("error" in r) return fail(r.error, r.status);
  return Response.json({ ok: true, to: r.to });
}
