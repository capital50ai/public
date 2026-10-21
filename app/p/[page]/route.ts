import { isLive } from "@/lib/backend";
import { getReal } from "@/lib/returns";
import { PAGES, render, scriptJson, type PageName } from "@/lib/pages";
import { createClient } from "@/lib/supabase/server";
import { buildAccount, type LedgerRow } from "@/lib/account";
import { kycState } from "@/lib/kyc-server";
import { jazzcashConfig, nowpaymentsConfig, paymentsMode } from "@/lib/payments/config";
import { bankAccount } from "@/lib/payments/deposits";
import { methodToClient } from "@/lib/payouts";

export const dynamic = "force-dynamic";

const PREVIEW_NOTE =
  '<b style="color:var(--fg)">Preview.</b> Accounts open at launch. Nothing you type here leaves this device; continuing opens the dashboard preview.';
const LIVE_NOTE =
  '<b style="color:var(--fg)">Early access.</b> Your account is real. Deposits open at launch.';

const PREVIEW_RIBBON =
  "<b>Preview.</b> Sample deposits and members; every monthly return is the published record. Nothing here moves real money.";
const LIVE_RIBBON =
  "<b>Early access.</b> Balances come from your account ledger and the published monthly records. Deposits open at launch.";

const HTML = { "content-type": "text/html; charset=utf-8" };

export async function GET(req: Request, { params }: { params: Promise<{ page: string }> }) {
  const { page } = await params;
  if (!(PAGES as readonly string[]).includes(page)) return new Response("Not found", { status: 404 });
  const name = page as PageName;
  const realData = await getReal();
  const real = scriptJson(realData);

  if (name === "dashboard") {
    let me: Record<string, unknown> | null = null;
    let account = null;
    if (isLive()) {
      // Everything in one parallel round trip. RLS limits each read to the signed-in investor.
      const supabase = await createClient();
      const [{ data: { user } }, profile, kyc, bank, holdings, entries, closes, pending, methods, withdrawals] = await Promise.all([
        supabase.auth.getUser(),
        supabase.from("profiles").select("full_name, phone, email, city, referral_code, created_at").maybeSingle(),
        kycState(supabase).catch((e: Error) => e),
        bankAccount(),
        supabase.from("holdings").select("id, strategies(slug)").returns<{ id: string; strategies: { slug: string } }[]>(),
        supabase
          .from("ledger_entries")
          .select("holding_id, ref_id, type, amount, ym, created_at, meta")
          .order("ym")
          .order("created_at")
          .returns<LedgerRow[]>(),
        supabase.from("month_closes").select("ym").order("ym", { ascending: false }).limit(1),
        supabase.from("deposits").select("amount, created_at, strategies(slug)").eq("status", "pending")
          .order("created_at", { ascending: false }).limit(20)
          .returns<{ amount: number; created_at: string; strategies: { slug: string } }[]>(),
        supabase.from("payout_methods").select("id, type, account_hint, title, bank, ready_at").is("disabled_at", null).order("created_at"),
        supabase.from("withdrawals").select("amount, status, reason, created_at, updated_at")
          .in("status", ["requested", "approved", "rejected"]).order("created_at", { ascending: false }).limit(30),
      ]);
      if (!user) return Response.redirect(new URL("/auth.html", req.url), 303);
      const p = profile.data;
      if (profile.error || !p) {
        console.error("dashboard: no profile for user", user.id, profile.error?.message);
        return new Response("Your account is still being set up. Please try again in a minute.", { status: 503 });
      }
      if (kyc instanceof Error) {
        console.error("dashboard: kyc load failed", kyc.message);
        return new Response("We couldn't load your account. Please refresh in a moment.", { status: 503 });
      }
      me = {
        name: p.full_name || "Investor",
        phone: p.phone ? `0${p.phone.slice(3)}` : "",
        email: p.email ?? "",
        city: p.city ?? "",
        since: String(p.created_at).slice(0, 7),
        code: p.referral_code,
        kyc,
        pay: {
          mode: paymentsMode(),
          methods: {
            jazzcash: !!jazzcashConfig(),
            easypaisa: false,
            bank: paymentsMode() === "sandbox" || !!bank,
            usdt: !!nowpaymentsConfig(),
          },
        },
      };

      const failed = holdings.error || entries.error || closes.error || pending.error || methods.error || withdrawals.error;
      if (failed) {
        console.error("dashboard: account load failed", failed.message);
        return new Response("We couldn't load your account. Please refresh in a moment.", { status: 503 });
      }
      const slugOf = new Map(holdings.data.map((h) => [h.id, h.strategies.slug]));
      const lastPublished = realData.records.kitchen?.at(-1)?.ym ?? new Date().toISOString().slice(0, 7);
      account = buildAccount(entries.data, slugOf, closes.data[0]?.ym ?? null, lastPublished);
      const open = withdrawals.data.filter((w) => w.status === "requested" || w.status === "approved");
      me.methods = methods.data.map(methodToClient);
      // Same rule as available_to_withdraw() in the database: ledger balance minus withdrawals in review.
      me.available = Math.round((entries.data.reduce((a, r) => a + Number(r.amount), 0) - open.reduce((a, w) => a + Number(w.amount), 0)) * 100) / 100;
      me.notices = withdrawals.data
        .filter((w) => w.status === "rejected" && Date.parse(w.updated_at) > Date.now() - 30 * 864e5)
        .map((w) => ({ i: "x", t: "Withdrawal not approved", s: `Rs ${Number(w.amount).toLocaleString("en-US")}: ${w.reason ?? ""}`, h: "#wallet" }));
      for (const w of open) {
        const [y, m, day] = new Date(w.created_at).toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" }).split("-");
        account.events.unshift({ t: "wd", ym: `${y}-${m}`, day: Number(day), id: "", amt: -Number(w.amount) });
      }
      // Deposits started but not yet confirmed show in the history as pending (never in balances).
      for (const d of pending.data) {
        const [y, m, day] = new Date(d.created_at).toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" }).split("-");
        account.events.unshift({ t: "pd", ym: `${y}-${m}`, day: Number(day), id: d.strategies.slug, amt: Number(d.amount) });
      }
    }
    let html = await render("dashboard", {
      __C50_REAL__: real,
      __C50_ME__: scriptJson(me),
      __C50_ACCOUNT__: scriptJson(account),
    });
    if (account) html = html.split(PREVIEW_RIBBON).join(LIVE_RIBBON);
    return new Response(html, { headers: { ...HTML, "cache-control": "private, no-store" } });
  }

  let html = await render(name, { __C50_REAL__: real });
  if (name === "auth" && isLive()) html = html.split(PREVIEW_NOTE).join(LIVE_NOTE);
  return new Response(html, {
    headers: { ...HTML, "cache-control": "public, max-age=0, s-maxage=300, stale-while-revalidate=86400" },
  });
}
