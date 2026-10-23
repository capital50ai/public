"use client";
import { useEffect, useState } from "react";
import { button, Card, input } from "../ui";

type Setup = { factorId: string; qr: string; secret: string };

export default function StaffMfa() {
  const [state, setState] = useState<"loading" | "verify" | "enroll">("loading");
  const [setup, setSetup] = useState<Setup | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const r = await fetch("/api/admin/mfa");
      if (r.status === 401) return location.assign("/admin/login");
      const j = await r.json();
      if (j.aal2) return location.assign("/admin");
      if (j.enrolled) return setState("verify");
      const e = await fetch("/api/admin/mfa/enroll", { method: "POST" });
      const s = await e.json();
      if (!e.ok) return setError(s.error || "Couldn't start setup.");
      setSetup(s);
      setState("enroll");
    })();
  }, []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const code = new FormData(e.currentTarget).get("code");
    const r = await fetch("/api/admin/mfa/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, factorId: setup?.factorId }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) return location.assign(j.next);
    setError(j.error || "That code didn't match.");
    setBusy(false);
  }

  return (
    <Card className="mx-auto max-w-sm">
      <h1 className="mb-1 text-xl font-semibold">{state === "enroll" ? "Set up your authenticator" : "Enter your code"}</h1>
      {state === "loading" && !error && <p className="text-sm text-slate-400">Loading…</p>}
      {state === "enroll" && setup && (
        <div className="mb-4 space-y-3 text-sm text-slate-300">
          <p>Scan this with Google Authenticator, Microsoft Authenticator or Authy, then enter the 6-digit code it shows.</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={setup.qr} alt="Authenticator QR code" className="mx-auto h-48 w-48 rounded-lg bg-white p-2" />
          <p className="break-all text-xs text-slate-500">Can&apos;t scan? Enter this key: {setup.secret}</p>
        </div>
      )}
      {state === "verify" && <p className="mb-4 text-sm text-slate-400">Open your authenticator app and enter the 6-digit code for Capital 50.</p>}
      {state !== "loading" && (
        <form onSubmit={submit} className="space-y-4">
          <input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" className={`${input} text-center text-2xl tracking-[.4em]`} required />
          <button className={button} disabled={busy}>{busy ? "Checking…" : "Verify"}</button>
        </form>
      )}
      {error && <p className="mt-3 text-sm text-[#FF6B8B]">{error}</p>}
    </Card>
  );
}
