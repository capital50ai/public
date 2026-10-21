import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  let strategies = null;

  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("strategies")
      .select("*")
      .limit(6);
    strategies = data;
  } catch (error) {
    console.error("Failed to fetch strategies:", error);
    strategies = null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      {/* Navigation */}
      <nav className="border-b border-slate-800 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <div className="text-2xl font-bold text-white">Capital 50</div>
          <div className="flex gap-4">
            <Link
              href="/auth/login"
              className="px-4 py-2 text-slate-300 hover:text-white transition"
            >
              Sign In
            </Link>
            <Link
              href="/auth/register"
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition"
            >
              Sign Up
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="text-center mb-12">
          <h1 className="text-5xl sm:text-6xl font-bold text-white mb-4">
            AI-Powered <span className="text-gradient">Investment Strategies</span>
          </h1>
          <p className="text-xl text-slate-400 mb-8 max-w-2xl mx-auto">
            Invest in sophisticated trading algorithms managed by artificial intelligence.
            Grow your wealth passively while we handle the trading.
          </p>
          <div className="flex justify-center gap-4">
            <Link
              href="/auth/register"
              className="px-8 py-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition"
            >
              Start Investing
            </Link>
            <Link
              href="#strategies"
              className="px-8 py-4 border border-slate-600 hover:border-slate-400 text-white font-semibold rounded-lg transition"
            >
              Learn More
            </Link>
          </div>
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-3 gap-6 mb-16">
          <div className="glass rounded-lg p-6 text-center">
            <div className="text-3xl font-bold text-blue-400 mb-2">6</div>
            <p className="text-slate-300">Active Strategies</p>
          </div>
          <div className="glass rounded-lg p-6 text-center">
            <div className="text-3xl font-bold text-green-400 mb-2">+28%</div>
            <p className="text-slate-300">Avg Monthly Return</p>
          </div>
          <div className="glass rounded-lg p-6 text-center">
            <div className="text-3xl font-bold text-purple-400 mb-2">PKR 50K</div>
            <p className="text-slate-300">Minimum Investment</p>
          </div>
        </div>

        {/* Strategies Section */}
        <div id="strategies" className="mb-20">
          <h2 className="text-3xl font-bold text-white mb-8 text-center">Available Strategies</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {strategies && strategies.length > 0 ? (
              strategies.map((strategy) => (
                <Link
                  key={strategy.id}
                  href={`/strategies/${strategy.id}`}
                  className="glass rounded-lg p-6 hover:border-blue-500 transition group cursor-pointer"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className="text-lg font-semibold text-white group-hover:text-blue-400 transition">
                        {strategy.name}
                      </h3>
                      <div
                        className="w-3 h-3 rounded-full mt-2"
                        style={{ backgroundColor: strategy.color || "#60a5fa" }}
                      ></div>
                    </div>
                    <span className="text-xs px-2 py-1 bg-slate-800 rounded text-slate-300">
                      {strategy.risk_level}
                    </span>
                  </div>
                  <p className="text-slate-400 text-sm mb-4">{strategy.description}</p>
                  <div className="text-green-400 font-semibold">View Details →</div>
                </Link>
              ))
            ) : (
              <div className="col-span-3 text-center text-slate-400">
                Strategies coming soon
              </div>
            )}
          </div>
        </div>

        {/* How It Works */}
        <div className="mb-20">
          <h2 className="text-3xl font-bold text-white mb-12 text-center">How It Works</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {[
              { step: 1, title: "Sign Up", desc: "Create your account in seconds" },
              { step: 2, title: "Verify", desc: "Complete KYC verification" },
              { step: 3, title: "Invest", desc: "Choose a strategy and invest" },
              { step: 4, title: "Earn", desc: "Watch your returns grow" },
            ].map((item) => (
              <div key={item.step} className="glass rounded-lg p-6 text-center">
                <div className="text-3xl font-bold text-blue-400 mb-3">{item.step}</div>
                <h3 className="text-lg font-semibold text-white mb-2">{item.title}</h3>
                <p className="text-slate-400 text-sm">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* CTA Section */}
        <div className="glass rounded-lg p-12 text-center mb-20">
          <h2 className="text-3xl font-bold text-white mb-4">Ready to Start?</h2>
          <p className="text-slate-400 mb-8 text-lg">
            Join thousands of investors earning passive returns with AI-powered strategies
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
      <footer className="border-t border-slate-800 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-slate-400 text-sm">
          <p>&copy; 2026 Capital 50 AI. All rights reserved.</p>
          <p className="mt-2 text-xs">
            Disclaimer: Past performance does not guarantee future results. Investment involves risk.
          </p>
        </div>
      </footer>
    </div>
  );
}
