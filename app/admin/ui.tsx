// Small shared pieces for the staff pages.
export const input =
  "w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-white placeholder-slate-500 outline-none focus:border-[#3FD8E8]";
export const button =
  "w-full rounded-xl bg-[#3FD8E8] px-4 py-3 font-semibold text-[#03222A] hover:brightness-110 disabled:opacity-50";
export const field =
  "rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder-slate-500 outline-none focus:border-[#3FD8E8]";
export const btn = "rounded-xl bg-[#3FD8E8] px-4 py-2 text-sm font-semibold text-[#03222A] hover:brightness-110";
export const btnGhost = "rounded-xl border border-white/20 px-4 py-2 text-sm text-slate-200 hover:border-white/40";
export const btnDanger = "rounded-xl border border-[#FF6B8B]/50 px-4 py-2 text-sm text-[#FF6B8B] hover:border-[#FF6B8B]";

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-[rgba(120,220,232,.12)] bg-white/[.035] p-6 ${className}`}>{children}</div>;
}

export function Title({ title, sub }: { title: string; sub?: string }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold">{title}</h1>
      {sub && <p className="text-sm text-slate-400">{sub}</p>}
    </div>
  );
}

// Result of the last action (?done= / ?error=), shown at the top of a page.
export function Flash({ done, error }: { done?: string; error?: string }) {
  return (
    <>
      {done && <p className="rounded-xl bg-[#4BE3C1]/10 px-4 py-3 text-sm text-[#4BE3C1]">{done}</p>}
      {error && <p className="rounded-xl bg-[#FF6B8B]/10 px-4 py-3 text-sm text-[#FF6B8B]">{error}</p>}
    </>
  );
}

export function Stat({ label, value, sub, warn }: { label: string; value: React.ReactNode; sub?: React.ReactNode; warn?: boolean }) {
  return (
    <div className={`rounded-2xl border p-4 ${warn ? "border-[#FFC75C]/40 bg-[#FFC75C]/[.06]" : "border-white/10 bg-white/[.03]"}`}>
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}
