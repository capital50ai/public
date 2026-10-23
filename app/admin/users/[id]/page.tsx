import Link from "next/link";
import { Fragment } from "react";
import { notFound } from "next/navigation";
import { requireStaffPage } from "@/lib/staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { localPhone, monthLabel, rs, when } from "@/lib/admin";
import { btnDanger, btnGhost, Card, field, Flash, Title } from "../../ui";

export const dynamic = "force-dynamic";

const TYPE: Record<string, string> = { jazz: "JazzCash", easy: "Easypaisa", bank: "Bank", usdt: "USDT TRC20" };

export default async function UserDetail({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ done?: string; error?: string }>;
}) {
  const staff = await requireStaffPage();
  const { id } = await params;
  const { done, error } = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const a = createAdminClient();
  const { data: p } = await a.from("profiles")
    .select("id, user_id, full_name, phone, email, city, referral_code, referred_by, created_at, frozen_at, frozen_reason, affiliate_blocked_at, leaderboard_opt_in")
    .eq("user_id", id).maybeSingle();
  if (!p) notFound();

  const [kyc, ledger, deposits, withdrawals, methods, referrer, members, commissions, tickets, audit, holdings] = await Promise.all([
    a.from("kyc_applications").select("id, status, submitted_at, decided_at, rejection_reason").eq("user_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    a.from("ledger_entries").select("type, amount, ym, ref_type, created_at, holding_id").eq("user_id", id).order("created_at", { ascending: false }).limit(60),
    a.from("deposits").select("reference, amount, method, status, created_at, paid_at, strategies(name)").eq("user_id", id).order("created_at", { ascending: false }).limit(30)
      .returns<{ reference: string; amount: number; method: string; status: string; created_at: string; paid_at: string | null; strategies: { name: string } }[]>(),
    a.from("withdrawals").select("amount, status, reason, tx_ref, created_at, paid_at").eq("user_id", id).order("created_at", { ascending: false }).limit(30),
    a.from("payout_methods").select("type, account_hint, title, bank, ready_at, disabled_at").eq("user_id", id).order("created_at"),
    p.referred_by ? a.from("profiles").select("user_id, full_name, referral_code").eq("id", p.referred_by).maybeSingle() : Promise.resolve({ data: null }),
    a.from("profiles").select("user_id, full_name, created_at").eq("referred_by", p.id).order("created_at", { ascending: false }).limit(50),
    a.from("affiliate_commissions").select("id, kind, ym, commission_amount, status, void_reason, member_id").eq("affiliate_id", id).order("created_at", { ascending: false }).limit(30),
    a.from("tickets").select("id, ref, subject, status, last_message_at").eq("user_id", id).order("created_at", { ascending: false }).limit(10),
    a.from("audit_log").select("action, actor_role, reason, at").eq("entity_id", id).order("at", { ascending: false }).limit(20),
    a.from("holdings").select("id, strategies(name)").eq("user_id", id).returns<{ id: string; strategies: { name: string } }[]>(),
  ]);
  const byHolding = new Map<string, number>();
  let aff = 0;
  const { data: all } = await a.from("ledger_entries").select("holding_id, amount").eq("user_id", id);
  for (const r of all ?? []) {
    if (r.holding_id) byHolding.set(r.holding_id, (byHolding.get(r.holding_id) ?? 0) + Number(r.amount));
    else aff += Number(r.amount);
  }
  const hName = new Map((holdings.data ?? []).map((h) => [h.id, h.strategies.name]));
  const flagRoles = staff.role === "owner" || staff.role === "compliance";
  const row = "border-t border-white/5";

  return (
    <div className="space-y-6">
      <Link href="/admin/users" className="text-sm text-slate-400 hover:text-white">← Investors</Link>
      <Title title={p.full_name || "(no name)"} sub={`${localPhone(p.phone)} · ${p.email ?? "no email"} · ${p.city ?? ""} · joined ${when(p.created_at)}`} />
      <Flash done={done} error={error} />
      {p.frozen_at && <p className="rounded-xl bg-[#FF6B8B]/10 px-4 py-3 text-sm text-[#FF6B8B]">Frozen since {when(p.frozen_at)}: {p.frozen_reason}</p>}

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold">Account</h2>
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-slate-400">Identity</dt>
            <dd>{kyc.data ? <Link className="text-[#3FD8E8] hover:underline" href={`/admin/kyc/${kyc.data.id}`}>{kyc.data.status}</Link> : "not started"}{kyc.data?.rejection_reason ? ` · ${kyc.data.rejection_reason}` : ""}</dd>
            {[...byHolding].map(([h, v]) => <Fragment key={h}><dt className="text-slate-400">{hName.get(h)}</dt><dd>{rs(v)}</dd></Fragment>)}
            <dt className="text-slate-400">Affiliate balance</dt><dd>{rs(aff)}</dd>
            <dt className="text-slate-400">Invite code</dt><dd>{p.referral_code}{p.leaderboard_opt_in ? " · name on leaderboard" : ""}</dd>
            <dt className="text-slate-400">Invited by</dt>
            <dd>{referrer.data ? <Link className="text-[#3FD8E8] hover:underline" href={`/admin/users/${referrer.data.user_id}`}>{referrer.data.full_name} ({referrer.data.referral_code})</Link> : "—"}</dd>
          </dl>
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold">Holds</h2>
          {flagRoles ? (
            <div className="space-y-4">
              <form method="post" action={`/api/admin/users/${id}/flag`} className="flex flex-wrap gap-2">
                <input type="hidden" name="flag" value="freeze" /><input type="hidden" name="on" value={p.frozen_at ? "0" : "1"} />
                {!p.frozen_at && <input name="reason" required minLength={5} placeholder="Reason (kept in the audit log)" className={`${field} min-w-48 flex-1`} />}
                <button className={p.frozen_at ? btnGhost : btnDanger}>{p.frozen_at ? "Unfreeze account" : "Freeze account"}</button>
              </form>
              <p className="text-xs text-slate-500">Frozen: no deposits, payout changes or withdrawals. Balances keep earning.</p>
              <form method="post" action={`/api/admin/users/${id}/flag`} className="flex flex-wrap gap-2">
                <input type="hidden" name="flag" value="block_affiliate" /><input type="hidden" name="on" value={p.affiliate_blocked_at ? "0" : "1"} />
                {!p.affiliate_blocked_at && <input name="reason" required minLength={5} placeholder="Reason" className={`${field} min-w-48 flex-1`} />}
                <button className={p.affiliate_blocked_at ? btnGhost : btnDanger}>{p.affiliate_blocked_at ? "Unblock affiliate" : "Block affiliate"}</button>
              </form>
              <p className="text-xs text-slate-500">Blocked affiliates earn no new commission and leave the leaderboard.</p>
            </div>
          ) : <p className="text-sm text-slate-400">Owner or compliance can freeze accounts.</p>}
        </Card>
      </div>

      <Card>
        <h2 className="mb-3 font-semibold">Ledger (latest 60)</h2>
        <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm">
          <thead className="text-slate-400"><tr><th className="py-1">When</th><th>Type</th><th>Strategy</th><th>Month</th><th>Amount</th></tr></thead>
          <tbody>{ledger.data?.map((l, i) => (
            <tr key={i} className={row}><td className="py-1.5">{when(l.created_at)}</td><td>{l.type}{l.ref_type === "demo_seed" ? " (demo)" : ""}</td>
              <td>{l.holding_id ? hName.get(l.holding_id) : "affiliate"}</td><td>{monthLabel(l.ym)}</td>
              <td className={Number(l.amount) < 0 ? "text-[#FF6B8B]" : "text-[#4BE3C1]"}>{rs(l.amount)}</td></tr>
          ))}</tbody>
        </table></div>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold">Deposits</h2>
          {!deposits.data?.length ? <p className="text-sm text-slate-400">None.</p> : <ul className="space-y-1 text-sm">{deposits.data.map((d) => (
            <li key={d.reference} className="flex justify-between gap-2"><span>{d.reference} · {d.method} · {d.strategies.name}</span><span>{rs(d.amount)} · {d.status}</span></li>))}</ul>}
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold">Withdrawals</h2>
          {!withdrawals.data?.length ? <p className="text-sm text-slate-400">None.</p> : <ul className="space-y-1 text-sm">{withdrawals.data.map((w, i) => (
            <li key={i} className="flex justify-between gap-2"><span>{when(w.created_at)}{w.tx_ref ? ` · ${w.tx_ref}` : ""}{w.reason ? ` · ${w.reason}` : ""}</span><span>{rs(w.amount)} · {w.status}</span></li>))}</ul>}
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold">Payout methods</h2>
          {!methods.data?.length ? <p className="text-sm text-slate-400">None.</p> : <ul className="space-y-1 text-sm">{methods.data.map((m, i) => (
            <li key={i}>{TYPE[m.type]}{m.bank ? ` (${m.bank})` : ""} {m.account_hint} · {m.title}{m.disabled_at ? " · removed" : ""}</li>))}</ul>}
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold">Members invited ({members.data?.length ?? 0})</h2>
          {!members.data?.length ? <p className="text-sm text-slate-400">None.</p> : <ul className="space-y-1 text-sm">{members.data.map((m) => (
            <li key={m.user_id}><Link className="text-[#3FD8E8] hover:underline" href={`/admin/users/${m.user_id}`}>{m.full_name}</Link> · {when(m.created_at)}</li>))}</ul>}
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold">Commissions earned</h2>
          {!commissions.data?.length ? <p className="text-sm text-slate-400">None.</p> : <ul className="space-y-1 text-sm">{commissions.data.map((c) => (
            <li key={c.id} className="flex justify-between gap-2"><span>{monthLabel(c.ym)} · {c.kind === "deposit" ? "deposit" : "fee share"}{c.void_reason ? ` · ${c.void_reason}` : ""}</span>
              <span>{rs(c.commission_amount)} · {c.status}</span></li>))}</ul>}
          <Link href={`/admin/affiliates?affiliate=${id}`} className="mt-2 inline-block text-xs text-[#3FD8E8] hover:underline">Manage commissions →</Link>
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold">Tickets</h2>
          {!tickets.data?.length ? <p className="text-sm text-slate-400">None.</p> : <ul className="space-y-1 text-sm">{tickets.data.map((t) => (
            <li key={t.id}><Link className="text-[#3FD8E8] hover:underline" href={`/admin/tickets/${t.id}`}>{t.ref}</Link> · {t.subject} · {t.status}</li>))}</ul>}
        </Card>
      </div>

      <Card>
        <h2 className="mb-3 font-semibold">Audit trail</h2>
        {!audit.data?.length ? <p className="text-sm text-slate-400">Nothing yet.</p> : <ul className="space-y-1 text-sm">{audit.data.map((e, i) => (
          <li key={i}>{when(e.at)} · {e.action} · {e.actor_role}{e.reason ? ` · ${e.reason}` : ""}</li>))}</ul>}
      </Card>
    </div>
  );
}
