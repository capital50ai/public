import { isLive } from "@/lib/backend";
import { fail, readJson } from "@/lib/request";
import { withinLimit } from "@/lib/security";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Switches on the Profile page. "lb" is the leaderboard name opt-in, kept in its own column because the
// leaderboard reads it; the rest are display/alert preferences. 2-step login and the 24-hour withdrawal
// lock are always on for real accounts and can't be switched off here.
const KEYS = ["reinvest", "alerts", "affal", "hide", "lb"] as const;
type Key = (typeof KEYS)[number];

export async function POST(req: Request) {
  if (!isLive()) return Response.json({ preview: true });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return fail("Please log in again.", 401);
  const body = await readJson(req);
  const key = body.key as Key;
  if (!KEYS.includes(key) || typeof body.value !== "boolean") {
    return fail(body.key === "2fa" || body.key === "wlock" ? "This protection is always on for your account." : "Unknown setting.");
  }
  if (!(await withinLimit(`prefs:${user.id}`, 60, 3600))) return fail("Too many changes. Try again later.", 429);

  const admin = createAdminClient();
  const { data: p, error: e1 } = await admin.from("profiles").select("prefs").eq("user_id", user.id).single();
  if (e1 || !p) return fail("Couldn't save. Please try again.", 500);
  const update = key === "lb"
    ? { leaderboard_opt_in: body.value }
    : { prefs: { ...(p.prefs as Record<string, unknown>), [key]: body.value } };
  const { error } = await admin.from("profiles").update(update).eq("user_id", user.id);
  if (error) {
    console.error("prefs update failed", error.message);
    return fail("Couldn't save. Please try again.", 500);
  }
  return Response.json({ ok: true });
}
