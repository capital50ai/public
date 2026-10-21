import { requireStaffPage } from "@/lib/staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { paymentsMode } from "@/lib/payments/config";
import { Card } from "../ui";

export const dynamic = "force-dynamic";

type Dep = {
  id: string; reference: string; amount: number; method: string; status: string; created_at: string; paid_at: string | null;
  approvals: { staff: string; bank_ref: string; at: string }[]; status_note: string | null; mode: string;
  user_id: string; strategies: { name: string };
};
const rs = (n: number) => "Rs " + Number(n).toLocaleString("en-US");
const when = (t: string | null) => t ? new Date(t).toLocaleString("en-GB", { timeZone: "Asia/Karachi", dateStyle: "medium", timeStyle: "short" }) : "—";
const DONE: Record<string, string> = {
  "first-confirmation": "First confirmation saved. A second, different staff member must confirm with the same bank reference.",
  credited: "Second confirmation saved. The deposit is credited.",
  rejected: "Deposit marked failed.",
};

export default async function Deposits({ searchParams }: { searchParams: Promise<{ done?: string; error?: string }> }) {
  const staff = await requireStaffPage();
  const { done, error } = await searchParams;
  const admin = createAdminClient();
  const cols = "id, reference, amount, method, status, created_at, paid_at, approvals, status_note, mode, user_id, strategies(name)";
  const [{ data: bank }, { data: recent }, { data: events }] = await Promise.all([
    admin.from("deposits").select(cols).eq("method", "bank").eq("status", "pending").order("created_at").returns<Dep[]>(),
    admin.from("deposits").select(cols).neq("status", "pending").order("updated_at", { ascending: false }).limit(20).returns<Dep[]>(),
    admin.from("payment_events").select("provider, signature_ok, outcome, received_at, deposit_id").order("received_at", { ascending: false }).limit(20),
  ]);
  const ids = [...new Set([...(bank ?? []), ...(recent ?? [])].map((d) => d.user_id))];
  const { data: people } = ids.length ? await admin.from("profiles").select("user_id, full_name, phone").in("user_id", ids) : { data: [] };
  const who = (uid: string) => people?.find((p) => p.user_id === uid);
  const canConfirm = staff.role === "owner" || staff.role === "finance";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Deposits</h1>
        <p className="text-sm text-slate-400">
          Payments mode: <b className={paymentsMode() === "sandbox" ? "text-[#F7A93B]" : "text-[#4BE3C1]"}>{paymentsMode()}</b>.
          Bank transfers need two different owner/finance staff to confirm the same bank-statement reference.
        </p>
      </div>
      {done && <p className="rounded-xl bg-[#4BE3C1]/10 px-4 py-3 text-sm text-[#4BE3C1]">{DONE[done] ?? "Saved."}</p>}
      {error && <p className="rounded-xl bg-[#FF6B8B]/10 px-4 py-3 text-sm text-[#FF6B8B]">{error}</p>}

      <Card>
        <h2 className="mb-3 font-semibold">Bank transfers waiting ({bank?.length ?? 0})</h2>
        {!bank?.length ? <p className="text-sm text-slate-400">Nothing waiting.</p> : (
          <ul className="divide-y divide-white/10">
            {bank.map((d) => {
              const first = d.approvals[0];
              const mine = first?.staff === staff.userId;
              return (
                <li key={d.id} className="space-y-3 py-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span><b className="font-mono">{d.reference}</b> · {rs(d.amount)} · {d.strategies.name}{d.mode === "sandbox" && <span className="ml-2 text-xs text-[#F7A93B]">TEST</span>}</span>
                    <span className="text-sm text-slate-400">{who(d.user_id)?.full_name} · {who(d.user_id)?.phone} · {when(d.created_at)}</span>
                  </div>
                  {first && <p className="text-sm text-slate-300">1st confirmation: bank ref <b className="font-mono">{first.bank_ref}</b>, {when(first.at)}{mine ? " (you)" : ""}</p>}
                  {canConfirm && !mine && (
                    <form method="post" action={`/api/admin/deposits/${d.id}/confirm`} className="flex flex-wrap gap-2">
                      <input name="bank_ref" required minLength={4} placeholder="Bank statement transaction reference"
                        className="min-w-64 flex-1 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none focus:border-[#3FD8E8]" />
                      <button className="rounded-xl bg-[#4BE3C1] px-4 py-2 text-sm font-semibold text-[#03222A]">
                        {first ? "Confirm (2nd) and credit" : "Confirm received (1st)"}
                      </button>
                    </form>
                  )}
                  {canConfirm && (
                    <form method="post" action={`/api/admin/deposits/${d.id}/reject`} className="flex flex-wrap gap-2">
                      <input name="reason" required minLength={5} placeholder="Reason to mark failed, e.g. no transfer after 7 days"
                        className="min-w-64 flex-1 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none" />
                      <button className="rounded-xl border border-[#FF6B8B]/50 px-4 py-2 text-sm text-[#FF6B8B]">Mark failed</button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold">Recent deposits</h2>
        {!recent?.length ? <p className="text-sm text-slate-400">None yet.</p> : (
          <table className="w-full text-left text-sm">
            <thead className="text-slate-400"><tr><th className="py-1">Reference</th><th>Investor</th><th>Method</th><th>Amount</th><th>Status</th></tr></thead>
            <tbody>
              {recent.map((d) => (
                <tr key={d.id} className="border-t border-white/5">
                  <td className="py-2 font-mono">{d.reference}</td><td>{who(d.user_id)?.full_name}</td><td>{d.method}{d.mode === "sandbox" ? " (test)" : ""}</td>
                  <td>{rs(d.amount)}</td>
                  <td className={d.status === "paid" ? "text-[#4BE3C1]" : "text-[#FF6B8B]"}>{d.status}{d.status_note ? `: ${d.status_note}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold">Payment notifications (latest 20)</h2>
        {!events?.length ? <p className="text-sm text-slate-400">None yet.</p> : (
          <ul className="space-y-1 text-sm">
            {events.map((e, i) => (
              <li key={i} className="flex justify-between gap-4 border-b border-white/5 pb-1">
                <span>{e.provider} · {e.outcome}</span>
                <span className={e.signature_ok ? "text-slate-400" : "text-[#FF6B8B]"}>{e.signature_ok ? "signed" : "BAD SIGNATURE"} · {when(e.received_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
