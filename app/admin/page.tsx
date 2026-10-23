import Link from "next/link";
import { requireStaffPage } from "@/lib/staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { monthLabel, rs, when } from "@/lib/admin";
import { btnGhost, Card, Flash, Stat, Title } from "./ui";

export const dynamic = "force-dynamic";

type Overview = {
  investors: number; verified: number; invested: number; affiliate_owed: number; deposits_month: number; paid_out_month: number;
  kyc_review: number; bank_pending: number; wd_open: number; wd_open_amount: number; tickets_open: number; frozen: number;
  last_close: string | null; fees_total: number; commission_total: number; demo_present: boolean;
  reconcile: { ok: boolean; at: string; checks: { name: string; ok: boolean; detail: string }[] } | null;
};

export default async function AdminOverview({ searchParams }: { searchParams: Promise<{ done?: string; error?: string }> }) {
  const staff = await requireStaffPage();
  const { done, error } = await searchParams;
  const { data, error: e } = await createAdminClient().rpc("admin_overview");
  if (e || !data) throw new Error(`overview failed: ${e?.message}`);
  const o = data as Overview;
  const r = o.reconcile;
  const stale = !r || Date.parse(r.at) < Date.now() - 36 * 3600e3;

  return (
    <div className="space-y-6">
      <Title title="Overview" sub={`Signed in as ${staff.email} (${staff.role}).`} />
      <Flash done={done} error={error} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Invested (all holdings)" value={rs(o.invested)} sub={`${o.investors} investors · ${o.verified} verified`} />
        <Stat label="Affiliate earnings owed" value={rs(o.affiliate_owed)} sub={`${rs(o.commission_total)} credited in total`} />
        <Stat label="Deposits this month" value={rs(o.deposits_month)} sub={`Paid out ${rs(o.paid_out_month)}`} />
        <Stat label="Fees earned (all time)" value={rs(o.fees_total)} sub={o.last_close ? `Last closed: ${monthLabel(o.last_close)}` : "No month closed yet"} />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Link href="/admin/kyc"><Stat label="Identity checks" value={o.kyc_review} sub="waiting for review" warn={o.kyc_review > 0} /></Link>
        <Link href="/admin/deposits"><Stat label="Bank transfers" value={o.bank_pending} sub="to confirm" warn={o.bank_pending > 0} /></Link>
        <Link href="/admin/withdrawals"><Stat label="Withdrawals" value={o.wd_open} sub={rs(o.wd_open_amount)} warn={o.wd_open > 0} /></Link>
        <Link href="/admin/tickets"><Stat label="Tickets" value={o.tickets_open} sub="waiting for a reply" warn={o.tickets_open > 0} /></Link>
        <Link href="/admin/users?filter=frozen"><Stat label="Frozen accounts" value={o.frozen} sub="on hold" /></Link>
      </div>

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">
            Daily reconciliation{" "}
            {r && <span className={r.ok ? "text-[#4BE3C1]" : "text-[#FF6B8B]"}>{r.ok ? "· all checks pass" : "· MISMATCH FOUND"}</span>}
          </h2>
          {(staff.role === "owner" || staff.role === "finance") && (
            <form method="post" action="/api/admin/reconcile"><button className={btnGhost}>Run now</button></form>
          )}
        </div>
        {!r ? <p className="text-sm text-slate-400">Not run yet.</p> : (
          <>
            <p className={`mb-3 text-sm ${stale ? "text-[#FFC75C]" : "text-slate-400"}`}>
              Last run {when(r.at)}{stale ? " — over a day ago. Check the daily job (CRON_SECRET) in Vercel." : ""}
            </p>
            <ul className="space-y-1 text-sm">
              {r.checks.map((c) => (
                <li key={c.name} className="flex flex-wrap justify-between gap-2">
                  <span><span className={c.ok ? "text-[#4BE3C1]" : "text-[#FF6B8B]"}>{c.ok ? "Pass" : "FAIL"}</span> · {c.name}</span>
                  <span className="text-slate-400">{c.detail}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      {o.demo_present && (
        <Card className="border-[#FFC75C]/30">
          <p className="text-sm text-[#FFC75C]">
            The demo account (300 1234567) still exists. Remove it before launch: Settings → Launch checklist.
          </p>
        </Card>
      )}
    </div>
  );
}
