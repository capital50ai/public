"use client";
import { useState } from "react";
import { button, Card, input } from "../ui";

export default function StaffLogin() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    const r = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: f.get("email"), password: f.get("password") }),
    }).catch(() => null);
    const j = await r?.json().catch(() => ({}));
    if (r?.ok) return location.assign(j.next);
    setError(j?.error || "Something went wrong. Try again.");
    setBusy(false);
  }

  return (
    <Card className="mx-auto max-w-sm">
      <h1 className="mb-1 text-xl font-semibold">Staff login</h1>
      <p className="mb-6 text-sm text-slate-400">For Capital 50 AI staff only. Investors log in on the main site.</p>
      <form onSubmit={submit} className="space-y-4">
        <input name="email" type="email" autoComplete="username" placeholder="Work email" className={input} required />
        <input name="password" type="password" autoComplete="current-password" placeholder="Password" className={input} required />
        {error && <p className="text-sm text-[#FF6B8B]">{error}</p>}
        <button className={button} disabled={busy}>{busy ? "Checking…" : "Continue"}</button>
      </form>
    </Card>
  );
}
