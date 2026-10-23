import { must, staffAction, text } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";

const ROLES = ["owner", "compliance", "finance", "support"];

// Owner adds/changes/removes staff. A removed person keeps their login but loses every staff page.
export async function POST(req: Request) {
  return staffAction(req, ["owner"], "/admin/settings", async (staff, form) => {
    const a = createAdminClient();
    if (form.get("op") === "revoke") {
      must(await a.rpc("staff_revoke", { p_owner: staff.userId, p_user: text(form, "user", 40) }));
      return "Staff member removed.";
    }
    const role = text(form, "role", 20);
    if (!ROLES.includes(role)) throw new Error("Choose a role");
    return String(must(await a.rpc("staff_grant", { p_owner: staff.userId, p_email: text(form, "email", 200), p_role: role })));
  });
}
