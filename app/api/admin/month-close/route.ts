import { revalidateTag } from "next/cache";
import { must, rs, staffAction, text } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";

// Close a month (owner only): books profit/loss, fees and affiliate commission. Idempotent.
export async function POST(req: Request) {
  return staffAction(req, ["owner"], "/admin/returns", async (staff, form) => {
    if (form.get("confirm") !== "yes") throw new Error("Tick the box to confirm you checked the figures");
    const ym = text(form, "ym", 7);
    if (!/^\d{4}-\d{2}$/.test(ym)) throw new Error("Pick a month");
    const r = must(await createAdminClient().rpc("staff_close_month", { p_staff: staff.userId, p_ym: `${ym}-01` })) as
      { already_closed: boolean; holdings: number; total_profit: number; total_fees: number };
    revalidateTag("returns", { expire: 0 });
    return r.already_closed ? `${ym} was already closed.` :
      `Closed ${ym}: ${r.holdings} holdings, profit ${rs(r.total_profit)}, fees ${rs(r.total_fees)}.`;
  });
}
