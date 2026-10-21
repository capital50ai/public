import "server-only";

export const TOO_MANY = "Too many attempts. Please wait 15 minutes and try again.";
export const TOO_MANY_CODES = "Too many codes sent to this number. Please try again in an hour.";
export const GENERIC = "Something went wrong. Please try again.";

// Supabase Auth error codes -> plain-language messages for the auth page.
export function authMessage(err: { code?: string; message?: string; status?: number } | null): string {
  switch (err?.code) {
    case "invalid_credentials":
      return "Wrong mobile number or password.";
    case "phone_not_confirmed":
      return "This number isn't verified yet. Sign up again to get a new code.";
    case "user_already_exists":
    case "phone_exists":
      return "An account with this number already exists. Log in instead.";
    case "otp_expired":
      return "That code is wrong or has expired.";
    case "over_sms_send_rate_limit":
      return TOO_MANY_CODES;
    case "over_request_rate_limit":
      return TOO_MANY;
    case "weak_password":
      return "Use 8+ characters with a mix of uppercase, numbers or symbols.";
    case "same_password":
      return "Choose a password you haven't used here before.";
    case "sms_send_failed":
    case "phone_provider_disabled":
      return "We couldn't send a code right now. Please try again shortly.";
    default:
      if (err) console.error("auth error", err.code, err.status, err.message);
      return GENERIC;
  }
}
