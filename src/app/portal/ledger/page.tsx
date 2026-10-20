import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function LedgerPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const { data: entries } = await supabase
    .from("ledger_entries")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  const stats = {
    deposits: entries?.filter(e => e.entry_type === "deposit").reduce((sum, e) => sum + (e.amount || 0), 0) || 0,
    returns: entries?.filter(e => e.entry_type === "return").reduce((sum, e) => sum + (e.amount || 0), 0) || 0,
    fees: entries?.filter(e => e.entry_type === "fee").reduce((sum, e) => sum + (e.amount || 0), 0) || 0,
    withdrawals: entries?.filter(e => e.entry_type === "withdrawal").reduce((sum, e) => sum + (e.amount || 0), 0) || 0,
  };

  const getTypeColor = (type: string) => {
    const colors: Record<string, string> = {
      deposit: "text-blue-400",
      return: "text-green-400",
      fee: "text-red-400",
      withdrawal: "text-yellow-400",
      commission: "text-purple-400",
    };
    return colors[type] || "text-slate-400";
  };

  return (
    <div className="max-w-6xl">
      <h1 className="text-3xl font-bold text-white mb-8">Ledger</h1>

      {/* Summary Stats */}
      <div className="grid grid-cols-4 gap-6 mb-8">
        <div className="glass rounded-lg p-6">
          <p className="text-slate-400 text-sm mb-2">Total Deposits</p>
          <p className="text-2xl font-bold text-blue-400">PKR {stats.deposits.toLocaleString()}</p>
        </div>
        <div className="glass rounded-lg p-6">
          <p className="text-slate-400 text-sm mb-2">Total Returns</p>
          <p className="text-2xl font-bold text-green-400">PKR {stats.returns.toLocaleString()}</p>
        </div>
        <div className="glass rounded-lg p-6">
          <p className="text-slate-400 text-sm mb-2">Total Fees</p>
          <p className="text-2xl font-bold text-red-400">PKR {stats.fees.toLocaleString()}</p>
        </div>
        <div className="glass rounded-lg p-6">
          <p className="text-slate-400 text-sm mb-2">Total Withdrawals</p>
          <p className="text-2xl font-bold text-yellow-400">PKR {stats.withdrawals.toLocaleString()}</p>
        </div>
      </div>

      {/* Transactions Table */}
      <div className="glass rounded-lg overflow-hidden">
        <div className="p-6 border-b border-slate-700">
          <h2 className="text-xl font-bold text-white">Transaction History</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700">
                <th className="px-6 py-3 text-left text-slate-400 font-semibold text-sm">Date</th>
                <th className="px-6 py-3 text-left text-slate-400 font-semibold text-sm">Type</th>
                <th className="px-6 py-3 text-left text-slate-400 font-semibold text-sm">Amount</th>
                <th className="px-6 py-3 text-right text-slate-400 font-semibold text-sm">Balance After</th>
              </tr>
            </thead>
            <tbody>
              {entries && entries.length > 0 ? (
                entries.map((entry) => (
                  <tr key={entry.id} className="border-b border-slate-800 hover:bg-slate-800/50">
                    <td className="px-6 py-4 text-white text-sm">
                      {new Date(entry.created_at).toLocaleDateString()}
                    </td>
                    <td className={`px-6 py-4 font-semibold text-sm ${getTypeColor(entry.entry_type)}`}>
                      {entry.entry_type.charAt(0).toUpperCase() + entry.entry_type.slice(1)}
                    </td>
                    <td className="px-6 py-4 text-white font-semibold text-sm">
                      {entry.amount > 0 ? "+" : ""}PKR {entry.amount?.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 text-white text-right font-semibold text-sm">
                      PKR {entry.balance_after?.toLocaleString()}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-slate-400">
                    No transactions yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
