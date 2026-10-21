import { requireStaffPage } from "@/lib/staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { decrypt } from "@/lib/crypto";
import { Card } from "../ui";

export const dynamic = "force-dynamic";

type W = {
  id: string; user_id: string; amount: number; status: string; needs_approvals: number; created_at: string; paid_at: string | null;
  approvals: { staff: string; at: string }[]; tx_ref: string | null; reason: string | null;
  payout_methods: { type: string; account_enc: string; account_hint: string; title: string; bank: string | null };
};
const rs = (n: number) => "Rs " + Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
const when = (t: string | null) => t ? new Date(t).toLocaleString("en-GB", { timeZone: "Asia/Karachi", dateStyle: "medium", timeStyle: "short" }) : "—";
const TYPE: Record<string, string> = { jazz: "JazzCash", easy: "Easypaisa", bank: "Bank", usdt: "USDT TRC20" };
const DONE: Record<string, string> = {
  "first-approval": "First approval saved. This amount needs a second, different approver.",
  approved: "Approved. Send the money, then mark it paid with the transaction reference.",
  rejected: "Rejected. The investor sees your reason.",
  paid: "Marked paid. The amount has left the investor's balance.",
};

export default async function Withdrawals({ searchParams }: { searchParams: Promise<{ done?: string; error?: string }> }) {
  const staff = await requireStaffPage();
  const { done, error } = await searchParams;
  const admin = createAdminClient();
  const cols = "id, user_id, amount, status, needs_approvals, created_at, paid_at, approvals, tx_ref, reason, payout_methods(type, account_enc, account_hint, title, bank)";
  const [{ data: open }, { data: recent }] = await Promise.all([
    admin.from("withdrawals").select(cols).in("status", ["requested", "approved"]).order("created_at").returns<W[]>(),
    admin.from("withdrawals").select(cols).in("status", ["paid", "rejected", "cancelled"]).order("updated_at", { ascending: false }).limit(20).returns<W[]>(),
  ]);
  const ids = [...new Set([...(open ?? []), ...(recent ?? [])].map((w) => w.user_id))];
  const [{ data: people }, balances] = await Promise.all([
    ids.length ? admin.from("profiles").select("user_id, full_name, phone").in("user_id", ids) : Promise.resolve({ data: [] as { user_id: string; full_name: string; phone: string }[] }),
    Promise.all((open ?? []).map(async (w) => [w.user_id, Number((await admin.rpc("ledger_balance", { p_user: w.user_id })).data ?? 0)] as const)),
  ]);
  const who = (u: string) => people?.find((p) => p.user_id === u);
  const balance = new Map(balances);
  const money = staff.role === "owner" || staff.role === "finance";
  const account = (w: W) => { try { return decrypt(w.payout_methods.account_enc); } catch { return w.payout_methods.account_hint; } };
  const input = "min-w-56 flex-1 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none focus:border-[#3FD8E8]";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Withdrawals</h1>
        <p className="text-sm text-slate-400">Oldest first. Larger amounts need two different approvers. Money leaves the ledger only when marked paid.</p>
      </div>
      {done && <p className="rounded-xl bg-[#4BE3C1]/10 px-4 py-3 text-sm text-[#4BE3C1]">{DONE[done] ?? "Saved."}</p>}
      {error && <p className="rounded-xl bg-[#FF6B8B]/10 px-4 py-3 text-sm text-[#FF6B8B]">{error}</p>}

      <Card>
        <h2 className="mb-3 font-semibold">Open ({open?.length ?? 0})</h2>
        {!open?.length ? <p className="text-sm text-slate-400">Nothing to do.</p> : (
          <ul className="divide-y divide-white/10">
            {open.map((w) => {
              const mine = w.approvals.some((a) => a.staff === staff.userId);
              return (
                <li key={w.id} className="space-y-3 py-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span><b>{rs(w.amount)}</b> · {who(w.user_id)?.full_name} · {who(w.user_id)?.phone}</span>
                    <span className="text-sm text-slate-400">requested {when(w.created_at)} · balance {rs(balance.get(w.user_id) ?? 0)}</span>
                  </div>
                  <p className="text-sm">
                    To <b>{TYPE[w.payout_methods.type]}</b>{w.payout_methods.bank ? ` (${w.payout_methods.bank})` : ""}:{" "}
                    <span className="font-mono">{money && w.status === "approved" ? account(w) : w.payout_methods.account_hint}</span> · title {w.payout_methods.title}
                  </p>
                  <p className="text-sm text-slate-400">
                    {w.status === "approved" ? "Approved" : `Approvals ${w.approvals.length} of ${w.needs_approvals}`}{mine ? " (including yours)" : ""}
                  </p>
                  {money && w.status === "requested" && !mine && (
                    <form method="post" action={`/api/admin/withdrawals/${w.id}/approve`}>
                      <button className="rounded-xl bg-[#4BE3C1] px-4 py-2 text-sm font-semibold text-[#03222A]">
                        Approve{w.needs_approvals === 2 ? (w.approvals.length ? " (2nd)" : " (1st of 2)") : ""}
                      </button>
                    </form>
                  )}
                  {money && w.status === "approved" && (
                    <form method="post" action={`/api/admin/withdrawals/${w.id}/pay`} className="flex flex-wrap gap-2">
                      <input name="tx_ref" required minLength={4} placeholder="Transaction reference of the payment you sent" className={input} />
                      <button className="rounded-xl bg-[#3FD8E8] px-4 py-2 text-sm font-semibold text-[#03222A]">Mark paid</button>
                    </form>
                  )}
                  {money && (
                    <form method="post" action={`/api/admin/withdrawals/${w.id}/reject`} className="flex flex-wrap gap-2">
                      <input name="reason" required minLength={5} placeholder="Reason to reject (the investor sees it)" className={input} />
                      <button className="rounded-xl border border-[#FF6B8B]/50 px-4 py-2 text-sm text-[#FF6B8B]">Reject</button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold">Recent</h2>
        {!recent?.length ? <p className="text-sm text-slate-400">None yet.</p> : (
          <table className="w-full text-left text-sm">
            <thead className="text-slate-400"><tr><th className="py-1">Investor</th><th>Amount</th><th>To</th><th>Status</th></tr></thead>
            <tbody>
              {recent.map((w) => (
                <tr key={w.id} className="border-t border-white/5">
                  <td className="py-2">{who(w.user_id)?.full_name}</td><td>{rs(w.amount)}</td>
                  <td>{TYPE[w.payout_methods.type]} {w.payout_methods.account_hint}</td>
                  <td className={w.status === "paid" ? "text-[#4BE3C1]" : "text-slate-400"}>
                    {w.status}{w.tx_ref ? ` · ${w.tx_ref}` : ""}{w.reason ? `: ${w.reason}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
