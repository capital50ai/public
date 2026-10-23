import { must, staffAction } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";

// Run the reconciliation now (it also runs daily from /api/cron/reconcile).
export async function POST(req: Request) {
  return staffAction(req, ["owner", "finance"], "/admin", async () => {
    const r = must(await createAdminClient().rpc("run_reconciliation", { p_trigger: "staff" })) as { ok: boolean };
    return r.ok ? "Reconciliation ran: every check passes." : "Reconciliation ran and found a mismatch. See below.";
  });
}
