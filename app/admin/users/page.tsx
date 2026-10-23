import Link from "next/link";
import { requireStaffPage } from "@/lib/staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { localPhone, rs, when } from "@/lib/admin";
import { btn, Card, field, Title } from "../ui";

export const dynamic = "force-dynamic";

type U = { user_id: string; full_name: string; phone: string | null; email: string | null; referral_code: string; created_at: string;
  kyc: string; balance: number; members: number; frozen: boolean; affiliate_blocked: boolean };

export default async function Users({ searchParams }: { searchParams: Promise<{ q?: string; filter?: string }> }) {
  await requireStaffPage();
  const { q = "", filter } = await searchParams;
  const { data, error } = await createAdminClient()
    .rpc("admin_users", { p_q: q.slice(0, 80), p_filter: filter === "frozen" || filter === "blocked" ? filter : null, p_limit: 100 });
  if (error) throw new Error(error.message);
  const users = data as U[] | null;

  return (
    <div className="space-y-6">
      <Title title="Investors" sub="Search by name, mobile, email or invite code." />
      <form className="flex flex-wrap gap-2">
        <input name="q" defaultValue={q} placeholder="e.g. 0300 1234567, Ali, ali@mail.com, ALI42" className={`${field} min-w-64 flex-1`} />
        <select name="filter" defaultValue={filter ?? ""} className={field}>
          <option value="">Everyone</option><option value="frozen">Frozen</option><option value="blocked">Affiliate blocked</option>
        </select>
        <button className={btn}>Search</button>
      </form>
      <Card>
        {!users?.length ? <p className="text-sm text-slate-400">No investors found.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-slate-400"><tr><th className="py-1">Name</th><th>Mobile</th><th>Joined</th><th>Identity</th><th>Balance</th><th>Members</th><th></th></tr></thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.user_id} className="border-t border-white/5">
                    <td className="py-2"><Link className="text-[#3FD8E8] hover:underline" href={`/admin/users/${u.user_id}`}>{u.full_name || "(no name)"}</Link><div className="text-xs text-slate-500">{u.email}</div></td>
                    <td>{localPhone(u.phone)}</td><td>{when(u.created_at)}</td>
                    <td className={u.kyc === "verified" ? "text-[#4BE3C1]" : u.kyc === "review" ? "text-[#FFC75C]" : "text-slate-400"}>{u.kyc}</td>
                    <td>{rs(u.balance)}</td><td>{u.members}</td>
                    <td className="text-xs">{u.frozen && <span className="text-[#FF6B8B]">Frozen </span>}{u.affiliate_blocked && <span className="text-[#FFC75C]">Aff. blocked</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-slate-500">Showing up to 100, newest first.</p>
      </Card>
    </div>
  );
}
