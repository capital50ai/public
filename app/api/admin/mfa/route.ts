import { fail } from "@/lib/request";
import { staffSession } from "@/lib/staff";

// Whether this staff login already has an authenticator app set up.
export async function GET() {
  const { staff, aal2, supabase } = await staffSession();
  if (!staff) return fail("Please log in again.", 401);
  const { data } = await supabase.auth.mfa.listFactors();
  return Response.json({ enrolled: (data?.totp.length ?? 0) > 0, aal2 });
}
