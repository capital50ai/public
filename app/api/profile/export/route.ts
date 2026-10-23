import { isLive } from "@/lib/backend";
import { clientIp } from "@/lib/request";
import { audit, withinLimit } from "@/lib/security";
import { createClient } from "@/lib/supabase/server";

// "Download my data": everything we hold about the signed-in investor, read through their own
// session (row-level security), as JSON. Document images are listed, not included.
export async function GET(req: Request) {
  if (!isLive()) return Response.json({ preview: true });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Please log in again.", { status: 401 });
  if (!(await withinLimit(`export:${user.id}`, 10, 86400))) return new Response("Too many downloads today.", { status: 429 });
  const q = <T,>(p: PromiseLike<{ data: T }>) => p.then((r) => r.data);
  const [profile, kyc, documents, ledger, deposits, withdrawals, payoutMethods, commissions, tickets] = await Promise.all([
    q(supabase.from("profiles").select("full_name, phone, email, city, referral_code, created_at, prefs, leaderboard_opt_in").maybeSingle()),
    q(supabase.from("kyc_applications").select("status, personal, financial, pep, submitted_at, decided_at, rejection_reason").order("created_at")),
    q(supabase.from("kyc_documents").select("kind, mime, size_bytes, created_at")),
    q(supabase.from("ledger_entries").select("type, amount, ym, created_at, meta").order("created_at")),
    q(supabase.from("deposits").select("reference, amount, method, status, created_at, paid_at").order("created_at")),
    q(supabase.from("withdrawals").select("amount, status, reason, tx_ref, created_at, paid_at").order("created_at")),
    q(supabase.from("payout_methods").select("type, account_hint, title, bank, created_at, disabled_at")),
    q(supabase.from("affiliate_commissions").select("kind, ym, commission_amount, status, created_at")),
    q(supabase.from("tickets").select("ref, category, subject, status, created_at, ticket_messages(from_staff, body, created_at)")),
  ]);
  await audit({ actorId: user.id, action: "profile.export", entity: "auth.users", entityId: user.id, ip: clientIp(req) });
  const body = JSON.stringify({ exported: new Date().toISOString(), profile, kyc, documents, ledger, deposits, withdrawals,
    payoutMethods, affiliateCommissions: commissions, tickets }, null, 2);
  return new Response(body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="capital50-my-data-${new Date().toISOString().slice(0, 10)}.json"`,
      "cache-control": "private, no-store",
    },
  });
}
