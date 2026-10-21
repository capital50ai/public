import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

export const revalidate = 60;

export default async function StrategyPage({ params }: { params: { id: string } }) {
  const supabase = await createClient();

  // Fetch strategy
  const { data: strategy } = await supabase
    .from("strategies")
    .select("*")
    .eq("id", params.id)
    .single();

  // Fetch returns
  const { data: returnsData } = await supabase
    .from("strategy_returns")
    .select("*")
    .eq("strategy_id", params.id)
    .order("year_month", { ascending: true });

  const returns = returnsData || [];

  if (!strategy) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-white mb-4">Strategy Not Found</h1>
          <Link href="/" className="text-blue-400 hover:text-blue-300">
            Back to Home
          </Link>
        </div>
      </div>
    );
  }

  // Calculate statistics
  const monthlyReturns = returns.map((r) => r.monthly_return || 0).filter((r) => r !== 0);
  const avgReturn = monthlyReturns.length > 0
    ? (monthlyReturns.reduce((a, b) => a + b, 0) / monthlyReturns.length).toFixed(2)
    : "0.00";

  const bestMonth = monthlyReturns.length > 0
    ? Math.max(...monthlyReturns).toFixed(2)
    : "0.00";

  const worstMonth = monthlyReturns.length > 0
    ? Math.min(...monthlyReturns).toFixed(2)
    : "0.00";

  const volatility = monthlyReturns.length > 0
    ? (Math.sqrt(
        monthlyReturns.reduce((sum, r) => sum + Math.pow(r - parseFloat(avgReturn), 2), 0) /
          monthlyReturns.length
      )).toFixed(2)
    : "0.00";

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      {/* Navigation */}
      <nav className="border-b border-slate-800 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <Link href="/" className="text-2xl font-bold text-white">
            Capital 50
          </Link>
          <Link href="/auth/login" className="px-4 py-2 text-blue-400 hover:text-blue-300">
            Sign In
          </Link>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Header */}
        <div className="mb-12">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h1 className="text-4xl font-bold text-white mb-2">{strategy.name}</h1>
              <p className="text-slate-400">{strategy.description}</p>
            </div>
            <div className="text-right">
              <div
                className="w-6 h-6 rounded-full mx-auto mb-2"
                style={{ backgroundColor: strategy.color || "#60a5fa" }}
              ></div>
              <span className="text-xs px-3 py-1 bg-slate-800 rounded text-slate-300">
                {strategy.risk_level}
              </span>
            </div>
          </div>
        </div>

        {/* Statistics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-12">
          <div className="glass rounded-lg p-6">
            <p className="text-slate-400 text-sm mb-2">Average Return</p>
            <div className="text-3xl font-bold text-green-400">{avgReturn}%</div>
            <p className="text-xs text-slate-500 mt-2">per month</p>
          </div>
          <div className="glass rounded-lg p-6">
            <p className="text-slate-400 text-sm mb-2">Best Month</p>
            <div className="text-3xl font-bold text-blue-400">{bestMonth}%</div>
            <p className="text-xs text-slate-500 mt-2">peak return</p>
          </div>
          <div className="glass rounded-lg p-6">
            <p className="text-slate-400 text-sm mb-2">Worst Month</p>
            <div className={`text-3xl font-bold ${parseFloat(worstMonth) < 0 ? "text-red-400" : "text-green-400"}`}>
              {worstMonth}%
            </div>
            <p className="text-xs text-slate-500 mt-2">lowest return</p>
          </div>
          <div className="glass rounded-lg p-6">
            <p className="text-slate-400 text-sm mb-2">Volatility</p>
            <div className="text-3xl font-bold text-purple-400">{volatility}%</div>
            <p className="text-xs text-slate-500 mt-2">standard deviation</p>
          </div>
        </div>

        {/* Performance Chart */}
        {returns.length > 0 && (
          <div className="glass rounded-lg p-8 mb-12">
            <h2 className="text-xl font-bold text-white mb-6">24-Month Performance</h2>
            <div className="flex items-end justify-between h-64 gap-2">
              {returns.slice(-24).map((ret, idx) => {
                const maxVal = Math.max(...monthlyReturns.map(Math.abs));
                const heightPercent = (Math.abs(ret.monthly_return || 0) / maxVal) * 100;
                const isPositive = (ret.monthly_return || 0) >= 0;

                return (
                  <div key={idx} className="flex-1 flex flex-col items-center group">
                    <div
                      className={`w-full rounded-t transition-all ${
                        isPositive ? "bg-green-500 hover:bg-green-600" : "bg-red-500 hover:bg-red-600"
                      }`}
                      style={{ height: `${Math.max(heightPercent, 5)}%` }}
                      title={`${ret.monthly_return?.toFixed(2)}% - ${ret.year_month}`}
                    ></div>
                    <span className="text-xs text-slate-500 mt-2 hidden md:block">
                      {new Date(ret.year_month).toLocaleDateString("en-US", {
                        month: "short",
                      })}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Monthly Returns Table */}
        {returns.length > 0 && (
          <div className="glass rounded-lg p-8 mb-12 overflow-x-auto">
            <h2 className="text-xl font-bold text-white mb-6">Monthly Returns</h2>
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="text-left py-3 text-slate-400 font-semibold">Month</th>
                  <th className="text-right py-3 text-slate-400 font-semibold">Return %</th>
                </tr>
              </thead>
              <tbody>
                {returns.slice().reverse().map((ret, idx) => (
                  <tr key={idx} className="border-b border-slate-800 hover:bg-slate-800/50">
                    <td className="py-3 text-white">
                      {new Date(ret.year_month).toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "long",
                      })}
                    </td>
                    <td className={`text-right font-semibold ${
                      (ret.monthly_return || 0) >= 0 ? "text-green-400" : "text-red-400"
                    }`}>
                      {(ret.monthly_return || 0) >= 0 ? "+" : ""}{ret.monthly_return?.toFixed(2)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* CTA */}
        <div className="glass rounded-lg p-12 text-center">
          <h2 className="text-3xl font-bold text-white mb-4">Ready to Invest?</h2>
          <p className="text-slate-400 mb-8">
            Minimum investment: PKR 50,000
          </p>
          <Link
            href="/auth/register"
            className="inline-block px-8 py-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition"
          >
            Open Account Now
          </Link>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-slate-800 py-8 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-slate-400 text-sm">
          <p>&copy; 2026 Capital 50 AI. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
