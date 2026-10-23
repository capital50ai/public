import { REF_COOKIE, REF_DAYS } from "@/lib/affiliate";
import { cleanReferralCode } from "@/lib/validate";

// Invite links: /r/CODE. The first code opened is kept for 30 days and wins at sign-up.
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const code = cleanReferralCode((await params).code);
  const cookies = req.headers.get("cookie") ?? "";
  const first = cleanReferralCode(cookies.match(new RegExp(`(?:^|;\\s*)${REF_COOKIE}=([A-Za-z0-9]+)`))?.[1]);
  const keep = first ?? code;
  const to = new URL(keep ? `/auth.html?ref=${keep}#signup` : "/auth.html#signup", req.url);
  const res = new Response(null, { status: 302, headers: { location: to.toString(), "cache-control": "no-store" } });
  if (code && !first) {
    res.headers.append("set-cookie",
      `${REF_COOKIE}=${code}; Max-Age=${REF_DAYS * 86400}; Path=/; HttpOnly; SameSite=Lax${to.protocol === "https:" ? "; Secure" : ""}`);
  }
  return res;
}
