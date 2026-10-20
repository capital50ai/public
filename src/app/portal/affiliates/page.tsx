import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function AffiliatesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const { data: affiliateCode } = await supabase
    .from("affiliate_codes")
    .select("code")
    .eq("user_id", user.id)
    .single();

  const { data: commissions } = await supabase
    .from("affiliate_commissions")
    .select("*")
    .eq("referrer_id", user.id)
    .order("created_at", { ascending: false });

  const stats = {
    earned: commissions?.reduce((sum, c) => sum + (c.commission_amount || 0), 0) || 0,
    pending: commissions?.filter(c => c.status === "pending").reduce((sum, c) => sum + (c.commission_amount || 0), 0) || 0,
    paid: commissions?.filter(c => c.status === "paid").reduce((sum, c) => sum + (c.commission_amount || 0), 0) || 0,
    referrals: commissions?.length || 0,
  };

  return (
    <div className="max-w-6xl">
      <h1 className="text-3xl font-bold text-white mb-8">Affiliates</h1>

      {/* Referral Code */}
      <div className="glass rounded-lg p-6 mb-8">
        <h2 className="text-lg font-semibold text-white mb-4">Your Referral Code</h2>
        <div className="flex items-center gap-2">
          <code className="flex-1 bg-slate-900 border border-slate-600 px-4 py-3 rounded text-white font-mono text-lg">
            {affiliateCode?.code || "No code"}
          </code>
          <button
            onClick={() => {
              if (affiliateCode?.code) {
                navigator.clipboard.writeText(affiliateCode.code);
              }
            }}
            className="px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium transition-colors"
          >
            Copy
          </button>
        </div>
      </div>

      {/* Commission Stats */}
      <div className="grid grid-cols-4 gap-6 mb-8">
        <div className="glass rounded-lg p-6">
          <p className="text-slate-400 text-sm mb-2">Total Earned</p>
          <p className="text-2xl font-bold text-green-400">PKR {stats.earned.toLocaleString()}</p>
        </div>
        <div className="glass rounded-lg p-6">
          <p className="text-slate-400 text-sm mb-2">Pending</p>
          <p className="text-2xl font-bold text-yellow-400">PKR {stats.pending.toLocaleString()}</p>
        </div>
        <div className="glass rounded-lg p-6">
          <p className="text-slate-400 text-sm mb-2">Paid Out</p>
          <p className="text-2xl font-bold text-blue-400">PKR {stats.paid.toLocaleString()}</p>
        </div>
        <div className="glass rounded-lg p-6">
          <p className="text-slate-400 text-sm mb-2">Referrals</p>
          <p className="text-2xl font-bold text-purple-400">{stats.referrals}</p>
        </div>
      </div>

      {/* Commission History */}
      <div className="glass rounded-lg overflow-hidden">
        <div className="p-6 border-b border-slate-700">
          <h2 className="text-xl font-bold text-white">Commission History</h2>
        </div>
        {commissions && commissions.length > 0 ? (
          <div className="space-y-2">
            {commissions.map((commission) => (
              <div key={commission.id} className="px-6 py-4 border-b border-slate-800 flex justify-between items-center hover:bg-slate-800/50">
                <div>
                  <p className="text-white text-sm">{new Date(commission.created_at).toLocaleDateString()}</p>
                  <p className="text-slate-400 text-xs font-mono">{commission.referred_user_id}</p>
                </div>
                <div>
                  <p className="text-white font-semibold">PKR {commission.commission_amount?.toLocaleString()}</p>
                  <span className={`text-xs font-semibold ${
                    commission.status === "paid" ? "text-green-400" : "text-yellow-400"
                  }`}>
                    {commission.status === "paid" ? "Paid" : "Pending"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-6 py-8 text-center text-slate-400">
            No referrals yet. Share your code to start earning!
          </div>
        )}
      </div>
    </div>
  );
}
