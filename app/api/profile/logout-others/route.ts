import { isLive } from "@/lib/backend";
import { clientIp, fail } from "@/lib/request";
import { audit } from "@/lib/security";
import { createClient } from "@/lib/supabase/server";

// Ends every session except this one.
export async function POST(req: Request) {
  if (!isLive()) return Response.json({ preview: true });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return fail("Please log in again.", 401);
  const { error } = await supabase.auth.signOut({ scope: "others" });
  if (error) return fail("Couldn't log out other devices. Please try again.", 500);
  await audit({ actorId: user.id, action: "auth.logout_others", entity: "auth.users", entityId: user.id, ip: clientIp(req) });
  return Response.json({ ok: true });
}
