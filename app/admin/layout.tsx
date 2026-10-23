import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Capital 50 AI · Staff", robots: { index: false, follow: false } };

const NAV: [string, string][] = [
  ["/admin", "Overview"],
  ["/admin/returns", "Returns"],
  ["/admin/users", "Investors"],
  ["/admin/kyc", "Identity checks"],
  ["/admin/deposits", "Deposits"],
  ["/admin/withdrawals", "Withdrawals"],
  ["/admin/affiliates", "Affiliates"],
  ["/admin/tickets", "Tickets"],
  ["/admin/audit", "Audit log"],
  ["/admin/settings", "Settings"],
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#030D11] text-slate-100">
      <header className="border-b border-white/10 px-5 py-4">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <Link href="/admin" className="font-semibold tracking-tight">
            Capital 50 <span className="text-[#3FD8E8]">AI</span> <span className="text-slate-400 font-normal">· Staff</span>
          </Link>
          <a href="/api/admin/logout" className="text-sm text-slate-400 hover:text-white">Log out</a>
        </div>
        <nav className="mx-auto mt-3 flex max-w-6xl flex-wrap gap-x-4 gap-y-2 text-sm text-slate-400">
          {NAV.map(([href, label]) => <Link key={href} href={href} className="hover:text-white">{label}</Link>)}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-5 py-8">{children}</main>
    </div>
  );
}
