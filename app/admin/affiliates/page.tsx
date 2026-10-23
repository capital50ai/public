import Link from "next/link";
import { requireStaffPage } from "@/lib/staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { monthLabel, rs, when } from "@/lib/admin";
import { btnDanger, Card, field, Flash, Stat, Title } from "../ui";

export const dynamic = "force-dynamic";

type Board = { user_id: string; display_name: string; members: number; commission: number }[];
type C = { id: string; affiliate_id: string; member_id: string; kind: string; ym: string; base_amount: number; rate: number;
  commission_amount: number; status: string; void_reason: string | null; created_at: string };

export default async function Affiliates({ searchParams }: { searchParams: Promise<{ done?: string; error?: string; affiliate?: string; status?: string }> }) {
  const staff = await requireStaffPage();
  const { done, error, affiliate, status } = await searchParams;
  const a = createAdminClient();
  let q = a.from("affiliate_commissions")
    .select("id, affiliate_id, member_id, kind, ym, base_amount, rate, commission_amount, status, void_reason, created_at")
    .order("created_at", { ascending: false }).limit(100);
  if (affiliate && /^[0-9a-f-]{36}$/.test(affiliate)) q = q.eq("affiliate_id", affiliate);
  if (status === "pending" || status === "credited" || status === "void") q = q.eq("status", status);
  const [{ data: boardData }, { data: rows }, { data: settings }, { data: totals }] = await Promise.all([
    a.rpc("affiliate_leaderboard", { p_from: "2000-01-01" }),
    q.returns<C[]>(),
    a.from("app_settings").select("key, value").in("key", ["affiliate_fee_share_rate", "affiliate_deposit_rate"]),
    a.from("affiliate_commissions").select("status, commission_amount"),
  ]);
  const board = ((boardData as Board | null) ?? []).slice(0, 20);
  const ids = [...new Set([...board.map((b) => b.user_id), ...(rows ?? []).flatMap((r) => [r.affiliate_id, r.member_id])])];
  const { data: people } = ids.length ? await a.from("profiles").select("user_id, full_name, referral_code").in("user_id", ids) : { data: [] };
  const name = (u: string) => people?.find((p) => p.user_id === u)?.full_name || "(no name)";
  const rate = (k: string) => Number(settings?.find((s) => s.key === k)?.value ?? 0);
  const sum = (st: string) => (totals ?? []).filter((t) => t.status === st).reduce((x, t) => x + Number(t.commission_amount), 0);
  const canVoid = staff.role !== "support";

  return (
    <div className="space-y-6">
      <Title title="Affiliates" sub="Commissions are company money: nothing is taken from members. Voiding a credited commission writes a reversing entry." />
      <Flash done={done} error={error} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Fee share" value={`${+(rate("affiliate_fee_share_rate") * 100).toFixed(2)}% of the fee`} sub={<Link href="/admin/settings" className="text-[#3FD8E8]">Change in Settings</Link>} />
        <Stat label="Deposit commission" value={`${+(rate("affiliate_deposit_rate") * 100).toFixed(2)}%`} sub={rate("affiliate_deposit_rate") > 0 ? "paid by Capital 50" : "off"} />
        <Stat label="Credited" value={rs(sum("credited"))} />
        <Stat label="Pending" value={rs(sum("pending"))} sub={`voided ${rs(sum("void"))}`} />
      </div>

      <Card>
        <h2 className="mb-3 font-semibold">Top affiliates (all time)</h2>
        {!board.length ? <p className="text-sm text-slate-400">No commission credited yet.</p> : (
          <table className="w-full text-left text-sm">
            <thead className="text-slate-400"><tr><th className="py-1">#</th><th>Affiliate</th><th>Shown publicly as</th><th>Members</th><th>Earned</th></tr></thead>
            <tbody>{board.map((b, i) => (
              <tr key={b.user_id} className="border-t border-white/5">
                <td className="py-2">{i + 1}</td>
                <td><Link className="text-[#3FD8E8] hover:underline" href={`/admin/users/${b.user_id}`}>{name(b.user_id)}</Link></td>
                <td className="text-slate-400">{b.display_name}</td><td>{b.members}</td><td>{rs(b.commission)}</td>
              </tr>))}</tbody>
          </table>
        )}
      </Card>

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Commissions{affiliate ? ` · ${name(affiliate)}` : ""}</h2>
          <form className="flex gap-2">
            {affiliate && <input type="hidden" name="affiliate" value={affiliate} />}
            <select name="status" defaultValue={status ?? ""} className={field}><option value="">All</option><option value="pending">Pending</option><option value="credited">Credited</option><option value="void">Void</option></select>
            <button className={field}>Filter</button>
          </form>
        </div>
        {!rows?.length ? <p className="text-sm text-slate-400">None.</p> : (
          <ul className="divide-y divide-white/10">
            {rows.map((c) => (
              <li key={c.id} className="space-y-2 py-3 text-sm">
                <div className="flex flex-wrap justify-between gap-2">
                  <span>
                    <Link className="text-[#3FD8E8] hover:underline" href={`/admin/users/${c.affiliate_id}`}>{name(c.affiliate_id)}</Link> from{" "}
                    <Link className="hover:underline" href={`/admin/users/${c.member_id}`}>{name(c.member_id)}</Link> · {monthLabel(c.ym)} ·{" "}
                    {c.kind === "deposit" ? `${+(c.rate * 100).toFixed(2)}% of deposit ${rs(c.base_amount)}` : `${+(c.rate * 100).toFixed(2)}% of fee ${rs(c.base_amount)}`}
                  </span>
                  <span><b>{rs(c.commission_amount)}</b> · <span className={c.status === "void" ? "text-[#FF6B8B]" : c.status === "pending" ? "text-[#FFC75C]" : "text-[#4BE3C1]"}>{c.status}</span></span>
                </div>
                {c.void_reason && <p className="text-xs text-slate-400">{c.void_reason}</p>}
                {canVoid && c.status !== "void" && (
                  <form method="post" action={`/api/admin/commissions/${c.id}/void`} className="flex flex-wrap gap-2">
                    <input name="reason" required minLength={5} placeholder="Reason to void (e.g. duplicate account)" className={`${field} min-w-56 flex-1`} />
                    <button className={btnDanger}>Void</button>
                  </form>
                )}
                <p className="text-xs text-slate-500">{when(c.created_at)}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
