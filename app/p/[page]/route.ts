import { isLive } from "@/lib/backend";
import { getReal } from "@/lib/returns";
import { PAGES, render, scriptJson, type PageName } from "@/lib/pages";
import { createClient } from "@/lib/supabase/server";
import { buildAccount, type LedgerRow } from "@/lib/account";

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
    let me = null;
    let account = null;
    if (isLive()) {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return Response.redirect(new URL("/auth.html", req.url), 303);
      const { data: p, error } = await supabase
        .from("profiles")
        .select("full_name, phone, email, city, referral_code, created_at")
        .eq("user_id", user.id)
        .single();
      if (error || !p) {
        console.error("dashboard: no profile for user", user.id, error?.message);
        return new Response("Your account is still being set up. Please try again in a minute.", { status: 503 });
      }
      me = {
        name: p.full_name || "Investor",
        phone: p.phone ? `0${p.phone.slice(3)}` : "",
        email: p.email ?? "",
        city: p.city ?? "",
        since: String(p.created_at).slice(0, 7),
        code: p.referral_code,
      };

      const [holdings, entries, closes] = await Promise.all([
        supabase.from("holdings").select("id, strategies(slug)").returns<{ id: string; strategies: { slug: string } }[]>(),
        supabase
          .from("ledger_entries")
          .select("holding_id, type, amount, ym, created_at, meta")
          .not("holding_id", "is", null)
          .order("ym")
          .order("created_at")
          .returns<LedgerRow[]>(),
        supabase.from("month_closes").select("ym").order("ym", { ascending: false }).limit(1),
      ]);
      const failed = holdings.error || entries.error || closes.error;
      if (failed) {
        console.error("dashboard: account load failed", failed.message);
        return new Response("We couldn't load your account. Please refresh in a moment.", { status: 503 });
      }
      const slugOf = new Map(holdings.data.map((h) => [h.id, h.strategies.slug]));
      const lastPublished = realData.records.kitchen?.at(-1)?.ym ?? new Date().toISOString().slice(0, 7);
      account = buildAccount(entries.data, slugOf, closes.data[0]?.ym ?? null, lastPublished);
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
