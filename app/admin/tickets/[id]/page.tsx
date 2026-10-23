import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffPage } from "@/lib/staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { localPhone, when } from "@/lib/admin";
import { btn, btnGhost, Card, field, Flash, Title } from "../../ui";

export const dynamic = "force-dynamic";

export default async function Ticket({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ done?: string; error?: string }> }) {
  await requireStaffPage();
  const { id } = await params;
  const { done, error } = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const a = createAdminClient();
  const { data: t } = await a.from("tickets").select("id, ref, category, subject, status, user_id, created_at").eq("id", id).maybeSingle();
  if (!t) notFound();
  const [{ data: msgs }, { data: p }] = await Promise.all([
    a.from("ticket_messages").select("id, from_staff, body, created_at, author_id").eq("ticket_id", id).order("created_at"),
    a.from("profiles").select("full_name, phone, email").eq("user_id", t.user_id).maybeSingle(),
  ]);

  return (
    <div className="space-y-6">
      <Link href="/admin/tickets" className="text-sm text-slate-400 hover:text-white">← Tickets</Link>
      <Title title={`${t.ref} · ${t.subject}`} sub={`${t.category} · ${t.status} · opened ${when(t.created_at)}`} />
      <Flash done={done} error={error} />
      <p className="text-sm">
        From <Link href={`/admin/users/${t.user_id}`} className="text-[#3FD8E8] hover:underline">{p?.full_name}</Link> · {localPhone(p?.phone)} · {p?.email}
      </p>
      <Card>
        <ul className="space-y-4">
          {msgs?.map((m) => (
            <li key={m.id} className={`rounded-xl p-3 text-sm ${m.from_staff ? "ml-8 bg-[#3FD8E8]/10" : "mr-8 bg-white/5"}`}>
              <p className="mb-1 text-xs text-slate-400">{m.from_staff ? "Staff" : "Investor"} · {when(m.created_at)}</p>
              <p className="whitespace-pre-wrap">{m.body}</p>
            </li>
          ))}
        </ul>
      </Card>
      {t.status !== "closed" && (
        <Card>
          <form method="post" action={`/api/admin/tickets/${id}/reply`} className="space-y-3">
            <textarea name="body" required maxLength={1500} rows={4} placeholder="Reply (the investor sees this). Never ask for passwords or codes." className={`${field} w-full`} />
            <button className={btn}>Send reply</button>
          </form>
          <form method="post" action={`/api/admin/tickets/${id}/close`} className="mt-3">
            <button className={btnGhost}>Close ticket</button>
          </form>
        </Card>
      )}
    </div>
  );
}
