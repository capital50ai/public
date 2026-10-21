import "server-only";

// Test (sandbox) endpoints unless the owner explicitly sets PAYMENTS_MODE=live.
export const paymentsMode = (): "sandbox" | "live" => (process.env.PAYMENTS_MODE === "live" ? "live" : "sandbox");

export const jazzcashConfig = () => {
  const { JAZZCASH_MERCHANT_ID: merchantId, JAZZCASH_PASSWORD: password, JAZZCASH_INTEGRITY_SALT: salt } = process.env;
  return merchantId && password && salt ? { merchantId, password, salt } : null;
};

export const nowpaymentsConfig = () => {
  const { NOWPAYMENTS_API_KEY: apiKey, NOWPAYMENTS_IPN_SECRET: ipnSecret, USDT_PKR_RATE } = process.env;
  const rate = Number(USDT_PKR_RATE);
  return apiKey && ipnSecret && rate > 0 ? { apiKey, ipnSecret, rate } : null;
};
