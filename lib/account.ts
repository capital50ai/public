// Builds the dashboard's account data from ledger rows, in the exact shape the approved
// front-end produced from its sample deposits: { hold, events, ledger }.

export type LedgerRow = {
  holding_id: string | null;
  ref_id?: string | null;
  type: string;
  amount: number | string;
  ym: string; // YYYY-MM-DD, first of month
  created_at: string;
  meta: Record<string, unknown> | null;
};

type Hold = { id: string; inv: number; val: number; profit: number; fees: number };
type Event = { t: "in" | "out" | "pr" | "ls" | "fe" | "pd" | "wd"; ym: string; day: number; id: string; amt: number; r?: number };
type Month = { ym: string; bal: number; inv: number; profit: number; fee: number };
export type Account = { hold: Record<string, Hold>; events: Event[]; ledger: Month[] };

const ym7 = (d: string) => d.slice(0, 7);
const nextYm = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};
const cents = (n: number) => Math.round(n * 100) / 100;

function pkDay(iso: string): { ym: string; day: number } {
  const [y, m, d] = new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" }).split("-");
  return { ym: `${y}-${m}`, day: Number(d) };
}

function dayOf(row: LedgerRow): number {
  const d = Number(row.meta?.day);
  if (Number.isInteger(d) && d >= 1 && d <= 31) return d;
  return Number(new Date(row.created_at).toLocaleString("en-US", { timeZone: "Asia/Karachi", day: "numeric" }));
}

/**
 * @param rows        the user's ledger rows that belong to a holding
 * @param slugOf      holding id -> strategy slug
 * @param lastClosed  latest closed month (YYYY-MM-DD) or null
 * @param emptyYm     month to show when the account has no money yet (YYYY-MM)
 */
export function buildAccount(rows: LedgerRow[], slugOf: Map<string, string>, lastClosed: string | null, emptyYm: string): Account {
  const hold: Record<string, Hold> = {};
  const events: Event[] = [];
  const byMonth = new Map<string, { move: number; inv: number; profit: number; fee: number }>();
  const payouts = new Map<string, Event>(); // one history line per withdrawal, however many holdings it came from

  for (const row of rows) {
    if (row.type === "affiliate_payout" && row.ref_id) {
      // The affiliate part of a withdrawal: not part of any holding, but the same payout line.
      const amt = Number(row.amount);
      const e = payouts.get(row.ref_id);
      if (e) e.amt = cents(e.amt + amt);
      else {
        const { ym, day } = pkDay(row.created_at);
        const ev: Event = { t: "out", ym, day, id: "", amt };
        payouts.set(row.ref_id, ev);
        events.push(ev);
      }
      continue;
    }
    const slug = row.holding_id ? slugOf.get(row.holding_id) : undefined;
    if (!slug) continue;
    const amt = Number(row.amount);
    // Real deposits belong to the month they were paid (they start earning the month after);
    // the demo's seeded deposits are dated by their own month.
    const paid = (row.type === "deposit" || row.type === "withdrawal") && row.meta?.source ? pkDay(row.created_at) : null;
    const ym = paid?.ym ?? ym7(row.ym);
    const h = (hold[slug] ??= { id: slug, inv: 0, val: 0, profit: 0, fees: 0 });
    const m = byMonth.get(ym) ?? { move: 0, inv: 0, profit: 0, fee: 0 };
    h.val += amt;
    m.move += amt;
    switch (row.type) {
      case "deposit":
      case "withdrawal":
        h.inv += amt;
        m.inv += amt;
        if (row.type === "withdrawal" && row.ref_id) {
          const e = payouts.get(row.ref_id);
          if (e) e.amt = cents(e.amt + amt);
          else {
            const ev: Event = { t: "out", ym, day: paid?.day ?? dayOf(row), id: "", amt };
            payouts.set(row.ref_id, ev);
            events.push(ev);
          }
        } else events.push({ t: amt > 0 ? "in" : "out", ym, day: paid?.day ?? dayOf(row), id: slug, amt });
        break;
      case "profit":
      case "loss":
        h.profit += amt;
        m.profit += amt;
        events.push({ t: amt >= 0 ? "pr" : "ls", ym, day: 28, id: slug, amt, r: Number(row.meta?.r) });
        break;
      case "fee":
        h.fees -= amt;
        m.fee -= amt;
        events.push({ t: "fe", ym, day: 28, id: slug, amt });
        break;
    }
    byMonth.set(ym, m);
  }

  for (const h of Object.values(hold)) {
    h.inv = cents(h.inv); h.val = cents(h.val); h.profit = cents(h.profit); h.fees = cents(h.fees);
  }

  const ledger: Month[] = [];
  const months = [...byMonth.keys()].sort();
  if (!months.length) return { hold, events, ledger: [{ ym: emptyYm, bal: 0, inv: 0, profit: 0, fee: 0 }] };

  const last = [months[months.length - 1], lastClosed ? ym7(lastClosed) : ""].sort().pop()!;
  let bal = 0, inv = 0;
  for (let ym = months[0]; ym <= last; ym = nextYm(ym)) {
    const m = byMonth.get(ym) ?? { move: 0, inv: 0, profit: 0, fee: 0 };
    bal += m.move;
    inv += m.inv;
    ledger.push({ ym, bal: cents(bal), inv: cents(inv), profit: cents(m.profit), fee: cents(m.fee) });
  }
  return { hold, events, ledger };
}
