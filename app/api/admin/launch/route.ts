import { must, staffAction, text } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";

// Owner, before launch: remove the demo account, or reset all test money (which also removes the demo).
// KYC files are deleted through the Storage API; the database rows are removed by the SQL functions.
export async function POST(req: Request) {
  return staffAction(req, ["owner"], "/admin/settings", async (staff, form) => {
    const a = createAdminClient();
    let files: string[] = [];
    let msg: string;
    if (form.get("op") === "demo") {
      if (text(form, "confirm", 40) !== "REMOVE DEMO") throw new Error("Type REMOVE DEMO to confirm");
      const { data: demo } = await a.from("profiles").select("user_id").eq("phone", "+923001234567").maybeSingle();
      if (!demo) return "The demo account is already removed.";
      const { data: docs } = await a.from("kyc_documents").select("storage_path").eq("user_id", demo.user_id);
      files = (docs ?? []).map((d) => d.storage_path);
      must(await a.rpc("purge_demo_data"));
      msg = "Demo account removed.";
    } else {
      const r = must(await a.rpc("prepare_for_launch", { p_staff: staff.userId, p_confirm: text(form, "confirm", 40) })) as
        { ledger_rows: number; withdrawals: number; deposits: number; files: string[] };
      files = r.files;
      msg = `Test money removed: ${r.ledger_rows} ledger rows, ${r.withdrawals} withdrawals, ${r.deposits} deposits.`;
    }
    if (files.length) {
      const { error } = await a.storage.from("kyc").remove(files);
      if (error) console.error("launch: KYC file cleanup failed", error.message, files);
    }
    await a.from("audit_log").insert({ actor_id: staff.userId, actor_role: "owner", action: "launch.files_removed", entity: "storage.kyc", after: { count: files.length } });
    return msg;
  });
}
