import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { authMessage, TOO_MANY_CODES } from "@/lib/auth-errors";
import { clientIp } from "@/lib/request";
import { withinLimit } from "@/lib/security";

// SMS codes that confirm a sensitive action (withdrawal, payout method, password, email) go to the
// investor's own verified number. The code proves they hold that phone right now.

const e164 = (user: User) => `+${(user.phone ?? "").replace(/^\+/, "")}`;
export const maskedPhone = (phone: string) => `+92 ${phone.slice(3, 6)} ••••${phone.slice(-3)}`;

// Sends a code. Returns an error message, or null when sent.
export async function sendOwnCode(supabase: SupabaseClient, user: User, req: Request): Promise<{ error: string; status: number } | { to: string }> {
  if (!user.phone) return { error: "Please log in again.", status: 401 };
  const phone = e164(user);
  if (!(await withinLimit(`otp:phone:${phone}`, 3, 3600)) || !(await withinLimit(`otp:ip:${clientIp(req)}`, 10, 3600)))
    return { error: TOO_MANY_CODES, status: 429 };
  const { error } = await supabase.auth.signInWithOtp({ phone, options: { shouldCreateUser: false } });
  if (error) return { error: authMessage(error), status: error.status === 429 ? 429 : 400 };
  return { to: maskedPhone(phone) };
}

// Checks a code. Returns an error message, or null when it is right.
export async function checkOwnCode(supabase: SupabaseClient, user: User, code: unknown): Promise<string | null> {
  const c = String(code ?? "").replace(/\D/g, "");
  if (c.length !== 6) return "Enter the 6-digit code sent to your phone.";
  if (!(await withinLimit(`otp-check:${user.id}`, 10, 900))) return "Too many wrong codes. Please wait 15 minutes.";
  const { data, error } = await supabase.auth.verifyOtp({ phone: e164(user), token: c, type: "sms" });
  if (error || data.user?.id !== user.id) return authMessage(error ?? { code: "otp_expired" });
  return null;
}
