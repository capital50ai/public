import { requireRolePage } from "@/lib/admin";
import { allPolicies, POLICY_IDS } from "@/lib/policies";
import { POLICY_DRAFTS } from "@/lib/policy-drafts";
import { btn, btnGhost, Card, field, Flash, Title } from "../ui";

export const dynamic = "force-dynamic";

export default async function Policies({ searchParams }: { searchParams: Promise<{ done?: string; error?: string }> }) {
  await requireRolePage(["owner"]);
  const { done, error } = await searchParams;
  const saved = await allPolicies();

  return (
    <div className="space-y-6">
      <Title title="Public policies" sub="The texts behind “Company & policies” on the home page. Until a policy is published, the site says “Not yet published”." />
      <Flash done={done} error={error} />
      <Card className="border-[#FFC75C]/30">
        <p className="text-sm text-[#FFC75C]">
          Drafts are a starting point written from how the platform works — not legal advice. Have a Pakistani lawyer review them,
          fill in every [BRACKET], and write Terms &amp; conditions and Custody with them. Publishing is blocked while a [BRACKET] remains.
        </p>
      </Card>
      {POLICY_IDS.map(([id, label]) => {
        const p = saved[id];
        const draft = !p && POLICY_DRAFTS[id];
        return (
          <Card key={id}>
            <form method="post" action="/api/admin/policies" className="space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-semibold">{label}</h2>
                <span className={`text-xs ${p?.published ? "text-[#4BE3C1]" : "text-slate-400"}`}>
                  {p?.published ? `Published · ${p.at}` : p ? `Draft saved · ${p.at}` : draft ? "Suggested draft (not saved)" : "Empty — needs your lawyer"}
                </span>
              </div>
              <input type="hidden" name="id" value={id} />
              <textarea name="text" rows={p?.text || draft ? 10 : 4} defaultValue={p?.text ?? (draft || "")} maxLength={30000}
                placeholder="Plain text. Leave a blank line between paragraphs." className={`${field} w-full font-mono text-xs leading-relaxed`} />
              <div className="flex flex-wrap gap-2">
                <button name="publish" value="0" className={btnGhost}>Save draft</button>
                <button name="publish" value="1" className={btn}>{p?.published ? "Update published text" : "Publish"}</button>
                {p?.published && <button name="publish" value="unpublish" className={btnGhost}>Unpublish</button>}
              </div>
            </form>
          </Card>
        );
      })}
    </div>
  );
}
