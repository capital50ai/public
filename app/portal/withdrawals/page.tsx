import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function WithdrawalsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const { data: payoutMethods } = await supabase
    .from("payout_methods")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  const { data: withdrawals } = await supabase
    .from("withdrawals")
    .select("*")
    .eq("user_id", user.id)
    .order("requested_at", { ascending: false });

  const stats = {
    pending: withdrawals?.filter(w => w.status === "pending").reduce((sum, w) => sum + (w.amount || 0), 0) || 0,
    total: withdrawals?.reduce((sum, w) => sum + (w.amount || 0), 0) || 0,
  };

  return (
    <div className="max-w-6xl">
      <h1 className="text-3xl font-bold text-white mb-8">Withdrawals</h1>

      {/* Payout Stats */}
      <div className="grid grid-cols-2 gap-6 mb-8">
        <div className="glass rounded-lg p-6">
          <p className="text-slate-400 text-sm mb-2">Pending Amount</p>
          <p className="text-2xl font-bold text-yellow-400">PKR {stats.pending.toLocaleString()}</p>
        </div>
        <div className="glass rounded-lg p-6">
          <p className="text-slate-400 text-sm mb-2">Total Withdrawn</p>
          <p className="text-2xl font-bold text-blue-400">PKR {stats.total.toLocaleString()}</p>
        </div>
      </div>

      {/* Payout Methods */}
      <div className="glass rounded-lg p-6 mb-8">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold text-white">Payout Methods</h2>
          <button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium transition-colors">
            Add Method
          </button>
        </div>
        {payoutMethods && payoutMethods.length > 0 ? (
          <div className="space-y-4">
            {payoutMethods.map((method) => (
              <div key={method.id} className="border border-slate-700 rounded-lg p-4">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-white font-semibold">{method.method_type}</p>
                    <p className="text-slate-400 text-sm">{method.account_holder}</p>
                    <p className="text-slate-500 text-sm mt-1">{method.account_details}</p>
                  </div>
                  {method.is_primary && (
                    <span className="px-2 py-1 bg-blue-900 text-blue-300 text-xs rounded">Primary</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-slate-400">No payout methods added yet.</p>
        )}
      </div>

      {/* Withdrawal History */}
      <div className="glass rounded-lg overflow-hidden">
        <div className="p-6 border-b border-slate-700">
          <h2 className="text-xl font-bold text-white">Withdrawal History</h2>
        </div>
        {withdrawals && withdrawals.length > 0 ? (
          <div className="space-y-4 p-6">
            {withdrawals.map((withdrawal) => (
              <div key={withdrawal.id} className="border border-slate-700 rounded-lg p-4 flex justify-between items-center hover:bg-slate-800/50">
                <div>
                  <p className="text-white font-semibold">PKR {withdrawal.amount?.toLocaleString()}</p>
                  <p className="text-slate-400 text-sm">
                    {new Date(withdrawal.requested_at).toLocaleDateString()}
                  </p>
                </div>
                <span className={`px-3 py-1 text-xs rounded font-semibold ${
                  withdrawal.status === "completed"
                    ? "bg-green-900 text-green-300"
                    : withdrawal.status === "pending"
                    ? "bg-yellow-900 text-yellow-300"
                    : "bg-red-900 text-red-300"
                }`}>
                  {withdrawal.status?.charAt(0).toUpperCase() + (withdrawal.status?.slice(1) || "")}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-6 py-8 text-center text-slate-400">
            No withdrawals yet
          </div>
        )}
      </div>
    </div>
  );
}
