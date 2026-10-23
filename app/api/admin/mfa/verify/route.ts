import { TOO_MANY } from "@/lib/auth-errors";
import { clientIp, fail, readJson } from "@/lib/request";
import { audit, withinLimit } from "@/lib/security";
import { staffSession } from "@/lib/staff";

export async function POST(req: Request) {
  const { staff, supabase } = await staffSession();
  if (!staff) return fail("Please log in again.", 401);
  const body = await readJson(req);
  const code = typeof body.code === "string" ? body.code.replace(/\D/g, "") : "";
  if (code.length !== 6) return fail("Enter the 6-digit code from your authenticator app.");
  if (!(await withinLimit(`staff-mfa:${staff.userId}`, 5, 900))) return fail(TOO_MANY, 429);

  const { data: factors } = await supabase.auth.mfa.listFactors();
  const verified = factors?.totp[0];
  const pending = (factors?.all ?? []).find((f) => f.factor_type === "totp" && f.status === "unverified" && f.id === body.factorId);
  const factor = verified ?? pending;
  if (!factor) return fail("Set up your authenticator first.", 409);

  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  if (error) return fail("That code didn't match. Check the time on your phone and try again.", 401);
  await audit({
    actorId: staff.userId, action: verified ? "staff.login_mfa" : "staff.mfa_enrolled",
    entity: "auth.users", entityId: staff.userId, ip: clientIp(req),
  });
  return Response.json({ ok: true, next: "/admin" });
}
