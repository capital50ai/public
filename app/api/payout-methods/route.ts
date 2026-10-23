import { isLive } from "@/lib/backend";
import { dataKeyConfigured, encrypt, keyedHash } from "@/lib/crypto";
import { accountError, accountHint, methodToClient, nameMatch, normalizeAccount, PAYOUT_TYPES, type PayoutType } from "@/lib/payouts";
import { clientIp, fail, readJson } from "@/lib/request";
import { accountFrozen, audit, ON_HOLD, withinLimit } from "@/lib/security";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const BANKS = ["Meezan Bank", "HBL", "UBL", "MCB", "Allied Bank", "Bank Alfalah", "Bank Al Habib", "Faysal Bank", "Askari Bank",
  "Standard Chartered", "JS Bank", "Soneri Bank", "Habib Metro", "BankIslami", "Dubai Islamic Bank", "National Bank of Pakistan", "Other"];

export async function POST(req: Request) {
  if (!isLive()) return Response.json({ preview: true });
  if (!dataKeyConfigured()) return fail("Payout methods aren't available yet. Please try again later.", 503);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return fail("Please log in again.", 401);
  if (!(await withinLimit(`payout-method:${user.id}`, 10, 86400))) return fail("Too many changes today. Try again tomorrow.", 429);
  if (await accountFrozen(user.id)) return fail(ON_HOLD, 403);

  const body = await readJson(req);
  const type = body.type as PayoutType;
  if (!PAYOUT_TYPES.includes(type)) return fail("Choose a payout type.");
  const account = normalizeAccount(type, String(body.acct ?? ""));
  const err = accountError(type, account);
  if (err) return fail(err, 400, "mErr1");

  const admin = createAdminClient();
  const { data: kyc } = await admin.from("kyc_applications").select("status, personal").eq("user_id", user.id)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (kyc?.status !== "verified") return fail("Verify your identity (CNIC) before adding a payout method.", 409);
  const verifiedName = String((kyc.personal as { fullName?: string }).fullName ?? "");

  // Owner rule: payouts only to accounts in the investor's own verified name.
  const title = type === "usdt" ? verifiedName : String(body.title ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
  if (type !== "usdt" && title.split(" ").length < 2) return fail("Enter the full account title.", 400, "mErr2");
  if (!nameMatch(title, verifiedName)) return fail(`The account must be in your own name (${verifiedName}).`, 400, "mErr2");
  const bank = type === "bank" ? String(body.bank ?? "") : null;
  if (type === "bank" && !BANKS.includes(bank!)) return fail("Choose your bank.");

  const hash = keyedHash(`${type}:${account}`);
  const { data: dup } = await admin.from("payout_methods").select("user_id").eq("account_hash", hash).is("disabled_at", null);
  if (dup?.some((d) => d.user_id === user.id)) return fail("You've already added this account.", 409, "mErr1");
  if (dup?.length) return fail("This account is registered to another investor. Contact support.", 409, "mErr1");

  const { data: m, error } = await admin.from("payout_methods").insert({
    user_id: user.id, type, account_enc: encrypt(account), account_hint: accountHint(account), account_hash: hash,
    bank, title, title_verified: true,
  }).select("id, type, account_hint, title, bank, ready_at").single();
  if (error) return fail("Couldn't save the payout method. Try again.", 500);
  await audit({ actorId: user.id, action: "payout_method.add", entity: "payout_methods", entityId: m.id, ip: clientIp(req),
    after: { type, account: m.account_hint, ready_at: m.ready_at } });
  return Response.json({ ok: true, method: methodToClient(m) });
}
