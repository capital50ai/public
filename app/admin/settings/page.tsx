import { requireRolePage, rs, when } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { btn, btnDanger, Card, field, Flash, Title } from "../ui";

export const dynamic = "force-dynamic";

const ROLES = { owner: "Owner: everything", compliance: "Compliance: identity checks, returns, freezes", finance: "Finance: deposits, withdrawals", support: "Support: tickets, read-only" };

export default async function Settings({ searchParams }: { searchParams: Promise<{ done?: string; error?: string }> }) {
  const me = await requireRolePage(["owner"]);
  const { done, error } = await searchParams;
  const a = createAdminClient();
  const [{ data: settings }, { data: staff }, { data: overview }] = await Promise.all([
    a.from("app_settings").select("key, value, updated_at"),
    a.from("staff_members").select("user_id, role, active, created_at").order("created_at"),
    a.rpc("admin_overview"),
  ]);
  const get = (k: string) => settings?.find((s) => s.key === k);
  const num = (k: string, d: number) => Number(get(k)?.value ?? d);
  const bank = (get("bank_account")?.value ?? {}) as { bank?: string; title?: string; iban?: string };
  const { data: users } = await a.auth.admin.listUsers({ perPage: 1000 });
  const email = (u: string) => users?.users.find((x) => x.id === u)?.email ?? u;
  const demo = (overview as { demo_present?: boolean } | null)?.demo_present;
  const pct = (x: number) => +(x * 100).toFixed(4);

  return (
    <div className="space-y-6">
      <Title title="Settings" sub="Owner only. Every change is recorded in the audit log with the old and new value." />
      <Flash done={done} error={error} />

      <Card>
        <h2 className="mb-1 font-semibold">Affiliate commission</h2>
        <p className="mb-4 text-sm text-slate-400">
          Both are paid by Capital 50 from its own money — nothing is ever taken from a member. The dashboard wording updates automatically.
          New rates apply to commissions created after the change; amounts already earned don&apos;t change.
        </p>
        <form method="post" action="/api/admin/settings" className="grid gap-3 md:grid-cols-3">
          <input type="hidden" name="key" value="affiliate_fee_share_rate" />
          <label className="text-sm md:col-span-2">Share of the 2.5% fee on members&apos; monthly profit (%)
            <input name="percent" type="number" step="0.01" min="0" max="100" required defaultValue={pct(num("affiliate_fee_share_rate", 0.15))} className={`${field} mt-1 w-full`} />
          </label>
          <button className={`${btn} self-end`}>Save fee share</button>
        </form>
        <form method="post" action="/api/admin/settings" className="mt-4 grid gap-3 md:grid-cols-3">
          <input type="hidden" name="key" value="affiliate_deposit_rate" />
          <label className="text-sm md:col-span-2">Commission on each member deposit (%, 0 = off, max 10)
            <input name="percent" type="number" step="0.01" min="0" max="10" required defaultValue={pct(num("affiliate_deposit_rate", 0))} className={`${field} mt-1 w-full`} />
          </label>
          <button className={`${btn} self-end`}>Save deposit commission</button>
        </form>
        <p className="mt-3 text-xs text-slate-500">
          Deposit commission stays pending until the deposit&apos;s first month closes, and is cancelled if the member withdraws before then
          (stops deposit-and-withdraw farming). Self-referrals (same CNIC) never earn.
        </p>
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold">Withdrawals</h2>
        <form method="post" action="/api/admin/settings" className="grid gap-3 md:grid-cols-3">
          <input type="hidden" name="key" value="withdrawal_two_approvals_above" />
          <label className="text-sm md:col-span-2">Two different approvers needed above (Rs)
            <input name="value" type="number" step="1" min="0" required defaultValue={num("withdrawal_two_approvals_above", 100000)} className={`${field} mt-1 w-full`} />
          </label>
          <button className={`${btn} self-end`}>Save</button>
        </form>
        <p className="mt-2 text-xs text-slate-500">Currently {rs(num("withdrawal_two_approvals_above", 100000))}. Applies to new requests.</p>
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold">Company bank account (shown to investors for bank transfers)</h2>
        <form method="post" action="/api/admin/settings" className="grid gap-3 md:grid-cols-2">
          <input type="hidden" name="key" value="bank_account" />
          <input name="bank" required defaultValue={bank.bank} placeholder="Bank, e.g. Meezan Bank" className={field} />
          <input name="title" required defaultValue={bank.title} placeholder="Account title" className={field} />
          <input name="iban" required defaultValue={bank.iban} placeholder="IBAN, PK.." className={`${field} md:col-span-2`} />
          <button className={btn}>Save bank account</button>
        </form>
        <p className="mt-2 text-xs text-slate-500">Last changed {when(get("bank_account")?.updated_at)}. Double-check the IBAN: investors send money to it.</p>
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold">Staff</h2>
        <ul className="mb-4 divide-y divide-white/10 text-sm">
          {staff?.map((s) => (
            <li key={s.user_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>{email(s.user_id)} · <b>{s.role}</b>{s.active ? "" : " · removed"}</span>
              {s.active && s.user_id !== me.userId && (
                <form method="post" action="/api/admin/staff">
                  <input type="hidden" name="op" value="revoke" /><input type="hidden" name="user" value={s.user_id} />
                  <button className={btnDanger}>Remove</button>
                </form>
              )}
            </li>
          ))}
        </ul>
        <form method="post" action="/api/admin/staff" className="grid gap-3 md:grid-cols-3">
          <input type="hidden" name="op" value="grant" />
          <input name="email" type="email" required placeholder="Their login email" className={field} />
          <select name="role" className={field}>{Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <button className={btn}>Add or change role</button>
        </form>
        <p className="mt-2 text-xs text-slate-500">
          First create their login in Supabase (Authentication → Users → Add user, with email and a strong password). They must set up an
          authenticator app on first sign-in.
        </p>
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold">Launch checklist</h2>
        <ul className="space-y-1 text-sm">
          <li>{demo ? "To do" : "Done"} · Demo account removed {demo && <span className="text-slate-400">(SQL Editor: <code>select public.purge_demo_data();</code>)</span>}</li>
          <li>{bank.iban ? "Done" : "To do"} · Company bank account set</li>
          <li>{(staff?.filter((s) => s.active).length ?? 0) >= 2 ? "Done" : "To do"} · At least two staff with money roles (bank deposits and large withdrawals need two people)</li>
          <li>Check · Payment keys and PAYMENTS_MODE=live set in Vercel only after a real test payment</li>
          <li>Check · CRON_SECRET set in Vercel (daily reconciliation)</li>
        </ul>
      </Card>
    </div>
  );
}
