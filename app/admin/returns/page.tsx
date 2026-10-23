import { requireStaffPage } from "@/lib/staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { monthLabel, rs, when } from "@/lib/admin";
import { btn, btnDanger, Card, field, Flash, Title } from "../ui";

export const dynamic = "force-dynamic";

type Ret = { ym: string; return_pct: number; status: "draft" | "mtd" | "published"; source_note: string; updated_at: string; strategies: { slug: string } };
type Preview = {
  ym: string; can_close: boolean; blocked: string | null;
  rows: { slug: string; name: string; holdings: number; value_start: number; r: number | null; status: string | null; profit: number | null; fees: number | null }[];
};

const addMonths = (ym: string, n: number) => {
  const d = new Date(`${ym.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
};
const TONE = { draft: "text-slate-400", mtd: "text-[#FFC75C]", published: "text-white" } as const;

export default async function Returns({ searchParams }: { searchParams: Promise<{ done?: string; error?: string }> }) {
  const staff = await requireStaffPage();
  const { done, error } = await searchParams;
  const admin = createAdminClient();
  const thisMonth = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" }).slice(0, 7);
  const [{ data: strategies }, { data: closes }] = await Promise.all([
    admin.from("strategies").select("slug, name").eq("active", true).order("sort_order"),
    admin.from("month_closes").select("ym, closed_at, holdings, total_profit, total_fees").order("ym", { ascending: false }).limit(6),
  ]);
  const lastClosed = closes?.[0]?.ym?.slice(0, 7) ?? null;
  const nextClose = lastClosed ? addMonths(lastClosed, 1) : addMonths(thisMonth, -1);
  const months = [...new Set([thisMonth, addMonths(thisMonth, -1), addMonths(thisMonth, -2), addMonths(thisMonth, -3), nextClose])].sort().reverse();
  const [{ data: rets }, { data: previewData }] = await Promise.all([
    admin.from("strategy_returns").select("ym, return_pct, status, source_note, updated_at, strategies(slug)")
      .gte("ym", `${months.at(-1)}-01`).returns<Ret[]>(),
    admin.rpc("preview_month_close", { p_ym: `${nextClose}-01` }),
  ]);
  const preview = previewData as Preview | null;
  const cell = (slug: string, ym: string) => rets?.find((r) => r.strategies.slug === slug && r.ym.startsWith(ym));
  const canEdit = staff.role === "owner" || staff.role === "compliance";
  const owner = staff.role === "owner";

  return (
    <div className="space-y-6">
      <Title title="Monthly returns" sub="Draft → month-to-date (shown as an estimate) → published after the month ends → close the month to book profit and fees." />
      <Flash done={done} error={error} />

      <Card>
        <h2 className="mb-3 font-semibold">Recent months</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-slate-400"><tr><th className="py-1">Strategy</th>{months.map((m) => <th key={m}>{monthLabel(m)}{lastClosed && m <= lastClosed ? " · closed" : ""}</th>)}</tr></thead>
            <tbody>
              {strategies?.map((s) => (
                <tr key={s.slug} className="border-t border-white/5">
                  <td className="py-2">{s.name}</td>
                  {months.map((m) => {
                    const c = cell(s.slug, m);
                    return <td key={m} className={c ? TONE[c.status] : "text-slate-600"} title={c ? `${c.status} · ${c.source_note} · ${when(c.updated_at)}` : ""}>
                      {c ? `${Number(c.return_pct) > 0 ? "+" : ""}${Number(c.return_pct)}%` : "—"}{c && c.status !== "published" ? ` (${c.status})` : ""}
                    </td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-500">Hover a figure to see its source note. Closed months are locked.</p>
      </Card>

      {canEdit && (
        <Card>
          <h2 className="mb-3 font-semibold">Enter a return</h2>
          <form method="post" action="/api/admin/returns" className="grid gap-3 md:grid-cols-6">
            <select name="slug" required className={`${field} md:col-span-2`}>{strategies?.map((s) => <option key={s.slug} value={s.slug}>{s.name}</option>)}</select>
            <input name="ym" type="month" required defaultValue={thisMonth} className={field} />
            <input name="pct" type="number" step="0.001" required placeholder="Return %" className={field} />
            <select name="status" className={`${field} md:col-span-2`}>
              <option value="mtd">Month-to-date estimate</option>
              <option value="draft">Draft (hidden)</option>
              {owner && <option value="published">Published (final)</option>}
            </select>
            <input name="note" required minLength={5} maxLength={300} placeholder="Source note, e.g. broker statement #, file name" className={`${field} md:col-span-5`} />
            <button className={btn}>Save</button>
          </form>
          <p className="mt-2 text-xs text-slate-500">Published figures appear on the public site within a few minutes. Only the owner can publish.</p>
        </Card>
      )}

      <Card>
        <h2 className="mb-1 font-semibold">Close {monthLabel(nextClose)}</h2>
        <p className="mb-3 text-sm text-slate-400">
          Books each investor&apos;s profit or loss and the 2.5% fee for the month, then credits affiliate commission. It can&apos;t be undone.
        </p>
        {preview && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="text-slate-400"><tr><th className="py-1">Strategy</th><th>Holdings</th><th>Value at start</th><th>Return</th><th>Profit / loss</th><th>Fees</th></tr></thead>
                <tbody>
                  {preview.rows.map((r) => (
                    <tr key={r.slug} className="border-t border-white/5">
                      <td className="py-2">{r.name}</td><td>{r.holdings}</td><td>{rs(r.value_start)}</td>
                      <td className={r.status === "published" ? "" : "text-[#FFC75C]"}>{r.r == null ? "missing" : `${r.r}%${r.status !== "published" ? ` (${r.status})` : ""}`}</td>
                      <td>{r.profit == null ? "—" : rs(r.profit)}</td><td>{r.fees == null ? "—" : rs(r.fees)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.can_close ? (
              owner ? (
                <form method="post" action="/api/admin/month-close" className="mt-4 flex flex-wrap items-center gap-3">
                  <input type="hidden" name="ym" value={nextClose} />
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="confirm" value="yes" required /> I checked the figures above</label>
                  <button className={btnDanger}>Close {monthLabel(nextClose)}</button>
                </form>
              ) : <p className="mt-3 text-sm text-slate-400">Ready. The owner closes the month.</p>
            ) : <p className="mt-3 text-sm text-[#FFC75C]">Not ready: {preview.blocked}.</p>}
          </>
        )}
      </Card>

      {!!closes?.length && (
        <Card>
          <h2 className="mb-3 font-semibold">Closed months</h2>
          <table className="w-full text-left text-sm">
            <thead className="text-slate-400"><tr><th className="py-1">Month</th><th>Holdings</th><th>Profit</th><th>Fees</th><th>Closed</th></tr></thead>
            <tbody>
              {closes.map((c) => (
                <tr key={c.ym} className="border-t border-white/5">
                  <td className="py-2">{monthLabel(c.ym)}</td><td>{c.holdings}</td><td>{rs(c.total_profit)}</td><td>{rs(c.total_fees)}</td><td>{when(c.closed_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
