// Small shared pieces for the staff pages.
export const input =
  "w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-white placeholder-slate-500 outline-none focus:border-[#3FD8E8]";
export const button =
  "w-full rounded-xl bg-[#3FD8E8] px-4 py-3 font-semibold text-[#03222A] hover:brightness-110 disabled:opacity-50";

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-[rgba(120,220,232,.12)] bg-white/[.035] p-6 ${className}`}>{children}</div>;
}
