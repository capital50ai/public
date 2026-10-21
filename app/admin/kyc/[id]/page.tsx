import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffPage } from "@/lib/staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { Card } from "../../ui";

export const dynamic = "force-dynamic";

const LABEL: Record<string, string> = {
  fullName: "Full name", father: "Father / husband", cnic: "CNIC", dob: "Date of birth", expiry: "CNIC expiry",
  gender: "Gender", addr: "Address", city: "City", occ: "Occupation", src: "Source of funds", inc: "Monthly income",
  exp: "Expected yearly investment", pep: "Politically exposed (PEP)", own: "Money is their own",
};
const DOCS = [["cnic_front", "CNIC front"], ["cnic_back", "CNIC back"], ["selfie", "Selfie"]] as const;

export default async function KycReview({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }>;
}) {
  const staff = await requireStaffPage();
  const { id } = await params;
  const { error } = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const admin = createAdminClient();
  const { data: app } = await admin.from("kyc_applications").select("*").eq("id", id).maybeSingle();
  if (!app) notFound();

  const [{ data: profile }, { data: docs }, { data: history }] = await Promise.all([
    admin.from("profiles").select("full_name, phone, email, created_at").eq("user_id", app.user_id).single(),
    admin.from("kyc_documents").select("kind, storage_path, mime, created_at").eq("application_id", id).order("created_at", { ascending: false }),
    admin.from("kyc_applications").select("id, status, rejection_reason, decided_at").eq("user_id", app.user_id).neq("id", id).order("created_at", { ascending: false }),
  ]);

  // Latest file per kind, each behind a 5-minute signed link.
  const files = await Promise.all(DOCS.map(async ([kind, label]) => {
    const doc = docs?.find((d) => d.kind === kind);
    if (!doc) return { kind, label, url: null as string | null, pdf: false };
    const { data } = await admin.storage.from("kyc").createSignedUrl(doc.storage_path, 300);
    return { kind, label, url: data?.signedUrl ?? null, pdf: doc.mime === "application/pdf" };
  }));

  const details = { ...app.personal, ...app.financial } as Record<string, unknown>;
  const canDecide = app.status === "review" && (staff.role === "owner" || staff.role === "compliance");

  return (
    <div className="space-y-6">
      <Link href="/admin/kyc" className="text-sm text-slate-400 hover:text-white">← All identity checks</Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{String(details.fullName ?? "Application")}</h1>
        <span className="rounded-full bg-white/10 px-3 py-1 text-xs uppercase tracking-wide">{app.status}</span>
        {app.pep && <span className="rounded-full bg-[#F7A93B]/15 px-3 py-1 text-xs text-[#F7A93B]">PEP: enhanced due diligence required</span>}
      </div>
      {error && <p className="rounded-xl bg-[#FF6B8B]/10 px-4 py-3 text-sm text-[#FF6B8B]">{error}</p>}

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold">Submitted details</h2>
          <dl className="space-y-2 text-sm">
            {Object.entries(LABEL).map(([k, label]) => (
              <div key={k} className="flex justify-between gap-4 border-b border-white/5 pb-2">
                <dt className="text-slate-400">{label}</dt>
                <dd className="text-right">{details[k] === true ? "Yes" : String(details[k] ?? "—")}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold">Account</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-slate-400">Sign-up name</dt><dd>{profile?.full_name}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-400">Mobile</dt><dd>{profile?.phone}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-400">Email</dt><dd>{profile?.email ?? "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-400">Joined</dt><dd>{String(profile?.created_at ?? "").slice(0, 10)}</dd></div>
          </dl>
          {!!history?.length && (
            <>
              <h3 className="mt-5 mb-2 text-sm font-semibold">Earlier applications</h3>
              <ul className="space-y-1 text-sm text-slate-400">
                {history.map((h) => <li key={h.id}>{h.status}{h.rejection_reason ? `: ${h.rejection_reason}` : ""}</li>)}
              </ul>
            </>
          )}
        </Card>
      </div>

      <Card>
        <h2 className="mb-1 font-semibold">Documents</h2>
        <p className="mb-4 text-xs text-slate-500">Links expire after 5 minutes. Reload the page for fresh ones.</p>
        <div className="grid gap-4 sm:grid-cols-3">
          {files.map((f) => (
            <figure key={f.kind} className="space-y-2">
              <figcaption className="text-sm text-slate-400">{f.label}</figcaption>
              {!f.url ? <p className="text-sm text-[#FF6B8B]">Missing</p>
                : f.pdf ? <a href={f.url} target="_blank" rel="noreferrer" className="text-[#3FD8E8] underline">Open PDF</a>
                : (
                  <a href={f.url} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={f.url} alt={f.label} className="aspect-[4/3] w-full rounded-lg bg-black object-contain" />
                  </a>
                )}
            </figure>
          ))}
        </div>
      </Card>

      {canDecide ? (
        <Card>
          <h2 className="mb-1 font-semibold">Decision</h2>
          <p className="mb-4 text-sm text-slate-400">
            Check the name, CNIC number, dates and photo match the documents and the selfie.
            {app.pep ? " This person declared PEP status: complete enhanced due diligence before approving." : ""}
          </p>
          <form method="post" action={`/api/admin/kyc/${id}/decide`} className="space-y-3">
            <textarea name="reason" rows={2} maxLength={500} placeholder="Reason, required to reject (the investor sees it), e.g. CNIC back photo is blurred"
              className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm outline-none focus:border-[#3FD8E8]" />
            <div className="flex flex-wrap gap-3">
              <button name="decision" value="approve" className="rounded-xl bg-[#4BE3C1] px-5 py-2.5 font-semibold text-[#03222A]">Approve</button>
              <button name="decision" value="reject" className="rounded-xl border border-[#FF6B8B]/50 px-5 py-2.5 font-semibold text-[#FF6B8B]">Reject</button>
            </div>
          </form>
        </Card>
      ) : app.status === "review" ? (
        <p className="text-sm text-slate-400">Only owner or compliance staff can approve or reject.</p>
      ) : (
        <p className="text-sm text-slate-400">Decided {String(app.decided_at ?? "").slice(0, 10)}{app.rejection_reason ? `: ${app.rejection_reason}` : ""}.</p>
      )}
    </div>
  );
}
