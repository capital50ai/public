import { isLive } from "@/lib/backend";
import { getReal } from "@/lib/returns";
import { PAGES, render, scriptJson, type PageName } from "@/lib/pages";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const PREVIEW_NOTE =
  '<b style="color:var(--fg)">Preview.</b> Accounts open at launch. Nothing you type here leaves this device; continuing opens the dashboard preview.';
const LIVE_NOTE =
  '<b style="color:var(--fg)">Early access.</b> Your account is real. Deposits open at launch, so dashboard figures are samples until then.';

const HTML = { "content-type": "text/html; charset=utf-8" };

export async function GET(req: Request, { params }: { params: Promise<{ page: string }> }) {
  const { page } = await params;
  if (!(PAGES as readonly string[]).includes(page)) return new Response("Not found", { status: 404 });
  const name = page as PageName;
  const real = scriptJson(await getReal());

  if (name === "dashboard") {
    let me = null;
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
    }
    const html = await render("dashboard", { __C50_REAL__: real, __C50_ME__: scriptJson(me) });
    return new Response(html, { headers: { ...HTML, "cache-control": "private, no-store" } });
  }

  let html = await render(name, { __C50_REAL__: real });
  if (name === "auth" && isLive()) html = html.split(PREVIEW_NOTE).join(LIVE_NOTE);
  return new Response(html, {
    headers: { ...HTML, "cache-control": "public, max-age=0, s-maxage=300, stale-while-revalidate=86400" },
  });
}
