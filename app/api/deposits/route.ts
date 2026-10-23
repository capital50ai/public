import { isLive } from "@/lib/backend";
import { clientIp, fail, readJson } from "@/lib/request";
import { accountFrozen, audit, ON_HOLD, withinLimit } from "@/lib/security";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { jazzcashConfig, nowpaymentsConfig, paymentsMode } from "@/lib/payments/config";
import { jazzcashCheckout } from "@/lib/payments/jazzcash";
import { nowpaymentsInvoice } from "@/lib/payments/nowpayments";
import { bankAccount, bankReference, effectiveLabel, METHODS, providerReference, type Method } from "@/lib/payments/deposits";

const SOON: Record<Method, string> = {
  jazzcash: "JazzCash deposits open soon. Use bank transfer for now.",
  easypaisa: "Easypaisa deposits open soon. Use bank transfer for now.",
  bank: "Bank transfer isn't set up yet. Please try again later.",
  usdt: "USDT deposits open soon. Use bank transfer for now.",
};

// Starts a deposit. The response says how to pay; nothing is credited until the payment is confirmed.
export async function POST(req: Request) {
  if (!isLive()) return Response.json({ preview: true });
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user) return fail("Please log in again.", 401);
  const body = await readJson(req);
  const method = body.method as Method;
  if (!METHODS.includes(method)) return fail("Choose how you'd like to pay.");
  const amount = Number(body.amount);
  if (!Number.isInteger(amount)) return fail("Enter a whole amount in rupees.");
  if (amount > 10_000_000) return fail("For deposits over Rs 10,000,000 please contact support.");

  const admin = createAdminClient();
  const { data: strategy } = await admin.from("strategies").select("id, name, min_deposit, active")
    .eq("slug", String(body.strategy ?? "")).maybeSingle();
  if (!strategy?.active) return fail("Choose a strategy.");
  if (amount < Number(strategy.min_deposit))
    return fail(`Minimum deposit is Rs ${Number(strategy.min_deposit).toLocaleString("en-US")}.`);
  if (!(await withinLimit(`deposit:${user.id}`, 10, 3600))) return fail("Too many deposit attempts. Try again in an hour.", 429);
  if (await accountFrozen(user.id)) return fail(ON_HOLD, 403);

  const mode = paymentsMode();
  const origin = new URL(req.url).origin;
  const jc = jazzcashConfig(), np = nowpaymentsConfig();
  const bank = method === "bank" ? await bankAccount() : null;
  const available = { jazzcash: !!jc, easypaisa: false, bank: !!bank || mode === "sandbox", usdt: !!np }[method];
  if (!available) return fail(SOON[method], 409);

  if (method === "bank") {
    // Asking again for the same transfer shows the same reference instead of creating a duplicate.
    const { data: open } = await admin.from("deposits").select("reference, amount")
      .eq("user_id", user.id).eq("strategy_id", strategy.id).eq("method", "bank").eq("status", "pending")
      .eq("amount", amount).gte("created_at", new Date(Date.now() - 7 * 864e5).toISOString()).limit(1).maybeSingle();
    const reference = open?.reference ?? await insertWithReference(admin, bankReference, {
      user_id: user.id, strategy_id: strategy.id, amount, method, mode,
    });
    if (!reference) return fail("Couldn't start the deposit. Try again.", 500);
    if (!open) await audit({ actorId: user.id, action: "deposit.start", entity: "deposits", entityId: reference, ip: clientIp(req), after: { amount, method } });
    return Response.json({
      kind: "bank", reference, amount, sandbox: mode === "sandbox", effective: effectiveLabel(),
      account: bank ?? { bank: "TEST BANK (not a real account)", title: "Capital 50 AI (test)", iban: "PK00TEST0000000000000000" },
    });
  }

  if (method === "jazzcash" && jc) {
    const reference = await insertWithReference(admin, providerReference, { user_id: user.id, strategy_id: strategy.id, amount, method, mode });
    if (!reference) return fail("Couldn't start the deposit. Try again.", 500);
    await audit({ actorId: user.id, action: "deposit.start", entity: "deposits", entityId: reference, ip: clientIp(req), after: { amount, method } });
    const { url, fields } = jazzcashCheckout({ mode, ...jc, reference, amountPkr: amount, returnUrl: `${origin}/api/payments/jazzcash/return` });
    return Response.json({ kind: "form", url, fields });
  }

  if (method === "usdt" && np) {
    const usd = Math.round((amount / np.rate) * 100) / 100;
    const reference = await insertWithReference(admin, providerReference, {
      user_id: user.id, strategy_id: strategy.id, amount, method, mode, meta: { usd, rate: np.rate },
    });
    if (!reference) return fail("Couldn't start the deposit. Try again.", 500);
    try {
      const inv = await nowpaymentsInvoice({
        mode, apiKey: np.apiKey, orderId: reference, usd, ipnUrl: `${origin}/api/webhooks/nowpayments`,
        successUrl: `${origin}/dashboard.html#wallet`, cancelUrl: `${origin}/dashboard.html#wallet`,
      });
      await admin.from("deposits").update({ meta: { usd, rate: np.rate, invoice_id: inv.id, invoice_url: inv.invoice_url } }).eq("reference", reference);
      await audit({ actorId: user.id, action: "deposit.start", entity: "deposits", entityId: reference, ip: clientIp(req), after: { amount, method, usd } });
      return Response.json({ kind: "redirect", url: inv.invoice_url });
    } catch (e) {
      console.error(e);
      await admin.rpc("close_deposit", { p_deposit: await idOf(admin, reference), p_status: "failed", p_actor: null, p_note: "Invoice could not be created" });
      return fail("USDT payments are unavailable right now. Try again later or use bank transfer.", 502);
    }
  }
  return fail(SOON[method], 409);
}

type Admin = ReturnType<typeof createAdminClient>;

async function insertWithReference(admin: Admin, make: () => string, row: Record<string, unknown>): Promise<string | null> {
  for (let i = 0; i < 5; i++) {
    const reference = make();
    const { error } = await admin.from("deposits").insert({ ...row, reference });
    if (!error) return reference;
    if (error.code !== "23505") { console.error("deposit insert failed", error.message); return null; }
  }
  return null;
}

async function idOf(admin: Admin, reference: string): Promise<string> {
  const { data } = await admin.from("deposits").select("id").eq("reference", reference).single();
  return data!.id;
}
