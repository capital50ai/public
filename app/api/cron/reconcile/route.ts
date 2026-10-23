import { timingSafeEqual } from "node:crypto";
import { isLive } from "@/lib/backend";
import { createAdminClient } from "@/lib/supabase/admin";

// Vercel Cron calls this daily with "Authorization: Bearer $CRON_SECRET" (see vercel.json).
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  if (!secret || got.length !== want.length || !timingSafeEqual(got, want)) return new Response("Unauthorized", { status: 401 });
  if (!isLive()) return Response.json({ preview: true });
  const { data, error } = await createAdminClient().rpc("run_reconciliation", { p_trigger: "cron" });
  if (error) {
    console.error("reconciliation failed to run", error.message);
    return Response.json({ ok: false, error: "run failed" }, { status: 500 });
  }
  if (!(data as { ok: boolean }).ok) console.error("RECONCILIATION MISMATCH", JSON.stringify(data));
  return Response.json({ ok: (data as { ok: boolean }).ok });
}
