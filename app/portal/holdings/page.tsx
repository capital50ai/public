import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function HoldingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const { data: holdings } = await supabase
    .from("holdings")
    .select("*, strategies(name, color, risk_level)")
    .eq("user_id", user.id);

  const totalInvested = holdings?.reduce((sum, h) => sum + (h.amount_invested || 0), 0) || 0;
  const totalCurrent = holdings?.reduce((sum, h) => sum + (h.current_value || 0), 0) || 0;
  const totalProfit = totalCurrent - totalInvested;
  const returnPercent = totalInvested > 0 ? ((totalProfit / totalInvested) * 100).toFixed(2) : "0.00";

  return (
    <div className="max-w-6xl">
      <h1 className="text-3xl font-bold text-white mb-8">Holdings</h1>

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-6 mb-8">
        <div className="glass rounded-lg p-6">
          <p className="text-slate-400 text-sm mb-2">Total Invested</p>
          <p className="text-2xl font-bold text-white">PKR {totalInvested.toLocaleString()}</p>
        </div>
        <div className="glass rounded-lg p-6">
          <p className="text-slate-400 text-sm mb-2">Current Value</p>
          <p className="text-2xl font-bold text-white">PKR {totalCurrent.toLocaleString()}</p>
        </div>
        <div className="glass rounded-lg p-6">
          <p className="text-slate-400 text-sm mb-2">Profit/Loss</p>
          <p className={`text-2xl font-bold ${totalProfit >= 0 ? "text-green-400" : "text-red-400"}`}>
            PKR {totalProfit.toLocaleString()}
          </p>
        </div>
        <div className="glass rounded-lg p-6">
          <p className="text-slate-400 text-sm mb-2">Return %</p>
          <p className={`text-2xl font-bold ${parseFloat(returnPercent) >= 0 ? "text-green-400" : "text-red-400"}`}>
            {returnPercent}%
          </p>
        </div>
      </div>

      {/* Holdings List */}
      <div className="glass rounded-lg p-6">
        <h2 className="text-xl font-bold text-white mb-4">Your Investments</h2>
        {holdings && holdings.length > 0 ? (
          <div className="space-y-4">
            {holdings.map((holding) => {
              const profit = (holding.current_value || 0) - (holding.amount_invested || 0);
              const profitPercent = holding.amount_invested > 0 ? ((profit / holding.amount_invested) * 100).toFixed(2) : "0.00";

              return (
                <div key={holding.id} className="border border-slate-700 rounded-lg p-4">
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-4 h-4 rounded-full"
                        style={{
                          backgroundColor:
                            holding.strategies?.color || "#60a5fa",
                        }}
                      ></div>
                      <div>
                        <h3 className="text-white font-semibold">{holding.strategies?.name}</h3>
                        <p className="text-xs text-slate-400">
                          {holding.strategies?.risk_level}
                        </p>
                      </div>
                    </div>
                    <span className="text-green-400 font-semibold">{profitPercent}%</span>
                  </div>
                  <div className="grid grid-cols-4 gap-4 text-sm">
                    <div>
                      <p className="text-slate-400">Invested</p>
                      <p className="text-white font-semibold">
                        PKR {holding.amount_invested?.toLocaleString()}
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-400">Current Value</p>
                      <p className="text-white font-semibold">
                        PKR {holding.current_value?.toLocaleString()}
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-400">Profit</p>
                      <p className={profit >= 0 ? "text-green-400" : "text-red-400"}>
                        PKR {profit.toLocaleString()}
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-400">Date</p>
                      <p className="text-white">
                        {holding.invested_date ? new Date(holding.invested_date).toLocaleDateString() : "—"}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-slate-400">No holdings yet. Start investing today!</p>
        )}
      </div>
    </div>
  );
}
