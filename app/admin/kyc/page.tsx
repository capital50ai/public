import Link from "next/link";
import { requireStaffPage } from "@/lib/staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { Card } from "../ui";

export const dynamic = "force-dynamic";

type Row = {
  id: string; status: string; pep: boolean | null; submitted_at: string | null; decided_at: string | null;
  personal: { fullName?: string; city?: string }; rejection_reason: string | null;
};

const when = (t: string | null) =>
  t ? new Date(t).toLocaleString("en-GB", { timeZone: "Asia/Karachi", dateStyle: "medium", timeStyle: "short" }) : "—";

export default async function KycQueue({ searchParams }: { searchParams: Promise<{ done?: string }> }) {
  const staff = await requireStaffPage();
  const { done } = await searchParams;
  const admin = createAdminClient();
  const cols = "id, status, pep, submitted_at, decided_at, personal, rejection_reason";
  const [{ data: queue }, { data: recent }] = await Promise.all([
    admin.from("kyc_applications").select(cols).eq("status", "review").order("submitted_at").returns<Row[]>(),
    admin.from("kyc_applications").select(cols).in("status", ["verified", "rejected"])
      .order("decided_at", { ascending: false }).limit(15).returns<Row[]>(),
  ]);

  const list = (rows: Row[] | null, empty: string, decided = false) =>
    rows?.length ? (
      <ul className="divide-y divide-white/10">
        {rows.map((r) => (
          <li key={r.id}>
            <Link href={`/admin/kyc/${r.id}`} className="flex items-center justify-between gap-4 py-3 hover:text-[#3FD8E8]">
              <span>
                <b className="font-medium">{r.personal.fullName || "No name"}</b>
                <span className="text-slate-400"> · {r.personal.city || "—"}</span>
                {r.pep && <span className="ml-2 rounded-full bg-[#F7A93B]/15 px-2 py-0.5 text-xs text-[#F7A93B]">PEP · EDD</span>}
              </span>
              <span className="text-right text-sm text-slate-400">
                {decided ? (
                  <span className={r.status === "verified" ? "text-[#4BE3C1]" : "text-[#FF6B8B]"}>{r.status} · {when(r.decided_at)}</span>
                ) : (
                  <>submitted {when(r.submitted_at)}</>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    ) : (
      <p className="text-sm text-slate-400">{empty}</p>
    );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Identity checks</h1>
        <p className="text-sm text-slate-400">Signed in as {staff.email} ({staff.role}). Oldest first.</p>
      </div>
      {done && <p className="rounded-xl bg-[#4BE3C1]/10 px-4 py-3 text-sm text-[#4BE3C1]">Application {done}. The investor sees it next time they open their dashboard.</p>}
      <Card>
        <h2 className="mb-3 font-semibold">Waiting for review ({queue?.length ?? 0})</h2>
        {list(queue, "Nothing waiting. New submissions appear here.")}
      </Card>
      <Card>
        <h2 className="mb-3 font-semibold">Recent decisions</h2>
        {list(recent, "No decisions yet.", true)}
      </Card>
    </div>
  );
}
