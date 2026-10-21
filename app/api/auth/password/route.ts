import { isLive } from "@/lib/backend";
import { authMessage } from "@/lib/auth-errors";
import { clientIp, fail, readJson } from "@/lib/request";
import { audit } from "@/lib/security";
import { createClient } from "@/lib/supabase/server";
import { passwordStrongEnough } from "@/lib/validate";

// Sets a new password for the signed-in user (used right after a reset code is verified).
export async function POST(req: Request) {
  if (!isLive()) return Response.json({ preview: true });
  const body = await readJson(req);
  if (!passwordStrongEnough(body.password))
    return fail("Use 8+ characters with a mix of uppercase, numbers or symbols.", 400, "password");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Your session expired. Request a new code.", 401);

  const { error } = await supabase.auth.updateUser({ password: body.password as string });
  if (error) return fail(authMessage(error), 400, "password");
  await audit({ actorId: user.id, action: "auth.password_changed", entity: "auth.users", entityId: user.id, ip: clientIp(req) });
  return Response.json({ ok: true });
}
