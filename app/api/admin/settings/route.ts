import { must, staffAction, text } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";

// Owner settings. Ranges are enforced by set_setting() in the database.
export async function POST(req: Request) {
  return staffAction(req, ["owner"], "/admin/settings", async (staff, form) => {
    const key = text(form, "key", 60);
    let value: unknown;
    if (key === "affiliate_fee_share_rate" || key === "affiliate_deposit_rate") {
      const p = Number(text(form, "percent", 20));
      if (!Number.isFinite(p)) throw new Error("Enter a percentage");
      value = Math.round(p * 100) / 10000; // percent → fraction, 2 decimals of a percent
    } else if (key === "withdrawal_two_approvals_above") {
      value = Number(text(form, "value", 20));
    } else if (key === "bank_account") {
      value = { bank: text(form, "bank", 80), title: text(form, "title", 120), iban: text(form, "iban", 40) };
    } else throw new Error("Unknown setting");
    must(await createAdminClient().rpc("set_setting", { p_staff: staff.userId, p_key: key, p_value: value }));
    return "Saved.";
  });
}
