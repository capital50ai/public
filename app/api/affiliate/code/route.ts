import { isLive } from "@/lib/backend";
import { fail, readJson } from "@/lib/request";
import { withinLimit } from "@/lib/security";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Change your invite code. Old codes keep pointing to you (set_referral_code checks and audits).
export async function POST(req: Request) {
  if (!isLive()) return Response.json({ preview: true });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return fail("Please log in again.", 401);
  if (!(await withinLimit(`aff-code:${user.id}`, 5, 86400))) return fail("You can change your code 5 times a day. Try again tomorrow.", 429);
  const body = await readJson(req);
  const { data, error } = await createAdminClient().rpc("set_referral_code", { p_user: user.id, p_code: String(body.code ?? "") });
  if (error) {
    const known = /^(Use 4|That code)/.test(error.message);
    if (!known) console.error("set_referral_code failed", error.message);
    return fail(known ? error.message : "Couldn't save the code. Please try again.", known ? 400 : 500);
  }
  return Response.json({ code: data });
}
