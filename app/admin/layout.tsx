import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Capital 50 AI · Staff", robots: { index: false, follow: false } };

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#030D11] text-slate-100">
      <header className="flex items-center justify-between border-b border-white/10 px-5 py-4">
        <Link href="/admin/kyc" className="font-semibold tracking-tight">
          Capital 50 <span className="text-[#3FD8E8]">AI</span> <span className="text-slate-400 font-normal">· Staff</span>
        </Link>
        <a href="/api/admin/logout" className="text-sm text-slate-400 hover:text-white">Log out</a>
      </header>
      <main className="mx-auto max-w-5xl px-5 py-8">{children}</main>
    </div>
  );
}
