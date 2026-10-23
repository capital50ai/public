import { revalidateTag } from "next/cache";
import { must, staffAction, text } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";

// Save a monthly return (draft / month-to-date / published). Rules live in set_strategy_return().
export async function POST(req: Request) {
  return staffAction(req, ["owner", "compliance"], "/admin/returns", async (staff, form) => {
    const ym = text(form, "ym", 7);
    if (!/^\d{4}-\d{2}$/.test(ym)) throw new Error("Pick a month");
    const pct = Number(text(form, "pct", 20));
    if (!Number.isFinite(pct)) throw new Error("Enter the return as a number, e.g. 12.5 or -3");
    const status = must(await createAdminClient().rpc("set_strategy_return", {
      p_staff: staff.userId, p_slug: text(form, "slug", 40), p_ym: `${ym}-01`, p_pct: pct,
      p_status: text(form, "status", 20), p_note: text(form, "note"),
    }));
    revalidateTag("returns", { expire: 0 });
    return `Saved ${text(form, "slug", 40)} ${ym}: ${pct}% (${status}).`;
  });
}
