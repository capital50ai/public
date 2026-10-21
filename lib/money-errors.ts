import "server-only";

// Messages raised by the money functions in the database are written for people; pass those through.
const PLAIN = [
  "Verify your identity", "Confirm with the code", "Choose one of your payout methods", "This payout method unlocks",
  "This account is not in your verified name", "Minimum withdrawal", "That is more than your available balance",
  "This withdrawal is already", "Withdrawal not found", "Invalid amount",
];

export function moneyMessage(err: { message?: string } | null, fallback = "Something went wrong. Please try again."): string {
  const m = err?.message ?? "";
  if (PLAIN.some((p) => m.startsWith(p))) return m;
  if (err) console.error("money function error", m);
  return fallback;
}
