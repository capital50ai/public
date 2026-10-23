import { revalidateTag } from "next/cache";
import { must, staffAction, text } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";

// Save, publish or unpublish one public policy (owner only; checks in set_policy()).
export async function POST(req: Request) {
  return staffAction(req, ["owner"], "/admin/policies", async (staff, form) => {
    const publish = form.get("publish") === "1";
    const r = must(await createAdminClient().rpc("set_policy", {
      p_staff: staff.userId, p_id: text(form, "id", 20), p_text: text(form, "text", 30000), p_published: publish,
    }));
    revalidateTag("policies", { expire: 0 });
    return r === "published" ? "Published. The home page shows it within a minute." : "Saved as a draft (not shown on the site).";
  });
}
