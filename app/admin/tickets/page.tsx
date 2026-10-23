import Link from "next/link";
import { requireStaffPage } from "@/lib/staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { when } from "@/lib/admin";
import { Card, field, Title } from "../ui";

export const dynamic = "force-dynamic";

type T = { id: string; ref: string; category: string; subject: string; status: string; last_message_at: string; user_id: string; assigned_to: string | null };

export default async function Tickets({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireStaffPage();
  const { status = "open" } = await searchParams;
  const a = createAdminClient();
  let q = a.from("tickets").select("id, ref, category, subject, status, last_message_at, user_id, assigned_to")
    .order("last_message_at", { ascending: status === "open" }).limit(100);
  if (status === "open" || status === "answered" || status === "closed") q = q.eq("status", status);
  const { data: tickets } = await q.returns<T[]>();
  const ids = [...new Set((tickets ?? []).map((t) => t.user_id))];
  const { data: people } = ids.length ? await a.from("profiles").select("user_id, full_name").in("user_id", ids) : { data: [] };

  return (
    <div className="space-y-6">
      <Title title="Support tickets" sub="Open = waiting for us (oldest first). Investors see replies in their dashboard." />
      <form className="flex gap-2">
        <select name="status" defaultValue={status} className={field}>
          <option value="open">Waiting for us</option><option value="answered">Replied</option><option value="closed">Closed</option><option value="all">All</option>
        </select>
        <button className={field}>Show</button>
      </form>
      <Card>
        {!tickets?.length ? <p className="text-sm text-slate-400">Nothing here.</p> : (
          <ul className="divide-y divide-white/10">
            {tickets.map((t) => (
              <li key={t.id} className="flex flex-wrap items-baseline justify-between gap-2 py-3 text-sm">
                <span>
                  <Link href={`/admin/tickets/${t.id}`} className="text-[#3FD8E8] hover:underline">{t.ref}</Link> · {t.subject}
                  <span className="text-slate-400"> · {t.category} · {people?.find((p) => p.user_id === t.user_id)?.full_name}</span>
                </span>
                <span className="text-slate-400">{t.status} · {when(t.last_message_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
