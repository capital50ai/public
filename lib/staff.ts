import "server-only";
import { notFound, redirect } from "next/navigation";
import { isLive } from "@/lib/backend";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type Staff = { userId: string; email: string; role: "owner" | "compliance" | "finance" | "support" };
type Session = { staff: Staff | null; aal2: boolean; supabase: Awaited<ReturnType<typeof createClient>> };

// Who is signed in, whether they are active staff, and whether they passed the authenticator code.
export async function staffSession(): Promise<Session> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { staff: null, aal2: false, supabase };
  const { data: row } = await createAdminClient()
    .from("staff_members").select("role").eq("user_id", user.id).eq("active", true).maybeSingle();
  if (!row) return { staff: null, aal2: false, supabase };
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return { staff: { userId: user.id, email: user.email ?? "", role: row.role }, aal2: aal?.currentLevel === "aal2", supabase };
}

// For staff pages: sends people to log in or to enter their code when needed.
export async function requireStaffPage(): Promise<Staff> {
  if (!isLive()) notFound();
  const { staff, aal2 } = await staffSession();
  if (!staff) redirect("/admin/login");
  if (!aal2) redirect("/admin/mfa");
  return staff;
}

// For staff actions: null means refuse.
export async function requireStaffApi(roles?: Staff["role"][]): Promise<Staff | null> {
  if (!isLive()) return null;
  const { staff, aal2 } = await staffSession();
  if (!staff || !aal2) return null;
  if (roles && !roles.includes(staff.role)) return null;
  return staff;
}

// Form posts must come from this site.
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  return !!origin && origin === new URL(req.url).origin;
}
