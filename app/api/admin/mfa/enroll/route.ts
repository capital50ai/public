import { fail } from "@/lib/request";
import { staffSession } from "@/lib/staff";

// First-time setup only. Once an authenticator is verified, a password alone can't add another.
export async function POST() {
  const { staff, supabase } = await staffSession();
  if (!staff) return fail("Please log in again.", 401);
  const { data: factors } = await supabase.auth.mfa.listFactors();
  if ((factors?.totp.length ?? 0) > 0) return fail("An authenticator is already set up. Enter its code.", 409);
  for (const f of factors?.all ?? []) if (f.factor_type === "totp" && f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });

  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Capital 50 staff ${Date.now()}` });
  if (error) return fail("Couldn't start authenticator setup. Try again.", 500);
  return Response.json({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
}
