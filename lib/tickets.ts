import "server-only";

export const TICKET_CATEGORIES = ["Deposit", "Withdrawal", "Verification (KYC)", "Affiliate", "Account", "Account closure", "Other"];

type Row = { id: string; ref: string; category: string; subject: string; status: string; created_at: string;
  ticket_messages: { from_staff: boolean; body: string; created_at: string }[] };

// The shape the dashboard's support view uses.
export function ticketToClient(t: Row) {
  return {
    id: t.id, ref: t.ref, cat: t.category, sub: t.subject, status: t.status, at: Date.parse(t.created_at),
    msgs: [...t.ticket_messages].sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((m) => ({ s: m.from_staff, b: m.body, at: Date.parse(m.created_at) })),
  };
}
export const TICKET_COLS = "id, ref, category, subject, status, created_at, ticket_messages(from_staff, body, created_at)";
