import Link from "next/link";
import { requireRolePage, when } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { Card, field, Title } from "../ui";

export const dynamic = "force-dynamic";

type E = { id: string; actor_id: string | null; actor_role: string | null; action: string; entity: string; entity_id: string | null;
  before: unknown; after: unknown; reason: string | null; ip: string | null; at: string };
const PAGE = 100;

export default async function Audit({ searchParams }: { searchParams: Promise<{ action?: string; who?: string; id?: string; before?: string }> }) {
  await requireRolePage(["owner", "compliance"]);
  const sp = await searchParams;
  const a = createAdminClient();
  let q = a.from("audit_log").select("id, actor_id, actor_role, action, entity, entity_id, before, after, reason, ip, at")
    .order("at", { ascending: false }).limit(PAGE);
  const action = sp.action?.replace(/[^a-z_.]/g, "").slice(0, 40);
  if (action) q = q.like("action", `${action}%`);
  if (sp.who && /^[0-9a-f-]{36}$/.test(sp.who)) q = q.eq("actor_id", sp.who);
  if (sp.id) q = q.eq("entity_id", sp.id.slice(0, 80));
  if (sp.before && !Number.isNaN(Date.parse(sp.before))) q = q.lt("at", sp.before);
  const { data: rows, error } = await q.returns<E[]>();
  if (error) throw new Error(error.message);
  const actors = [...new Set((rows ?? []).map((r) => r.actor_id).filter(Boolean))] as string[];
  const [{ data: staff }, { data: people }] = await Promise.all([
    actors.length ? a.from("staff_members").select("user_id").in("user_id", actors) : Promise.resolve({ data: [] as { user_id: string }[] }),
    actors.length ? a.from("profiles").select("user_id, full_name, email").in("user_id", actors) : Promise.resolve({ data: [] as { user_id: string; full_name: string; email: string | null }[] }),
  ]);
  const label = (u: string | null) => {
    if (!u) return "system";
    const p = people?.find((x) => x.user_id === u);
    return (p?.full_name || p?.email || u.slice(0, 8)) + (staff?.some((s) => s.user_id === u) ? " (staff)" : "");
  };
  const json = (v: unknown) => (v == null ? "" : JSON.stringify(v));
  const next = rows?.length === PAGE ? new URLSearchParams({ ...(action ? { action } : {}), ...(sp.who ? { who: sp.who } : {}), ...(sp.id ? { id: sp.id } : {}), before: rows.at(-1)!.at }) : null;

  return (
    <div className="space-y-6">
      <Title title="Audit log" sub="Every money movement, decision and setting change. Nothing here can be edited or deleted." />
      <form className="flex flex-wrap gap-2">
        <input name="action" defaultValue={action} placeholder="Action starts with, e.g. withdrawal. or settings" className={`${field} min-w-56 flex-1`} />
        <input name="id" defaultValue={sp.id} placeholder="Record id (user, deposit, …)" className={`${field} min-w-56 flex-1`} />
        {sp.who && <input type="hidden" name="who" value={sp.who} />}
        <button className={field}>Filter</button>
      </form>
      <Card>
        {!rows?.length ? <p className="text-sm text-slate-400">No entries.</p> : (
          <ul className="divide-y divide-white/10">
            {rows.map((r) => (
              <li key={r.id} className="space-y-1 py-2 text-sm">
                <div className="flex flex-wrap justify-between gap-2">
                  <span><b>{r.action}</b> · {r.entity}{r.entity_id ? <> · <Link className="text-[#3FD8E8] hover:underline" href={`/admin/audit?id=${encodeURIComponent(r.entity_id)}`}>{r.entity_id.slice(0, 36)}</Link></> : ""}</span>
                  <span className="text-slate-400">{when(r.at)}</span>
                </div>
                <p className="text-xs text-slate-400">
                  by {r.actor_id ? <Link className="hover:underline" href={`/admin/audit?who=${r.actor_id}`}>{label(r.actor_id)}</Link> : "system"} ({r.actor_role}){r.ip ? ` · ${r.ip}` : ""}{r.reason ? ` · “${r.reason}”` : ""}
                </p>
                {(r.before != null || r.after != null) && (
                  <p className="break-all font-mono text-xs text-slate-500">{r.before != null ? `${json(r.before)} → ` : ""}{json(r.after)}</p>
                )}
              </li>
            ))}
          </ul>
        )}
        {next && <Link href={`/admin/audit?${next}`} className="mt-3 inline-block text-sm text-[#3FD8E8] hover:underline">Older →</Link>}
      </Card>
    </div>
  );
}
