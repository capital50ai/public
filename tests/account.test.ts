import { describe, expect, it } from "vitest";
import { buildAccount, type LedgerRow } from "../lib/account";

const slugOf = new Map([["h1", "gold"]]);
const row = (o: Partial<LedgerRow>): LedgerRow => ({ holding_id: "h1", type: "deposit", amount: 0, ym: "2026-07-01", created_at: "2026-07-01T00:00:00Z", meta: {}, ...o });

describe("buildAccount", () => {
  it("dates a real deposit by the day it was paid, not the month it starts earning", () => {
    const acc = buildAccount([row({ amount: 15000, ym: "2026-11-01", created_at: "2026-10-21T10:00:00Z", meta: { source: "jazzcash_ipn" } })], slugOf, "2026-09-01", "2026-09");
    expect(acc.events[0]).toMatchObject({ t: "in", ym: "2026-10", day: 21, amt: 15000 });
    expect(acc.ledger.map((m) => [m.ym, m.bal])).toEqual([["2026-10", 15000]]);
    expect(acc.hold.gold).toMatchObject({ inv: 15000, val: 15000, profit: 0, fees: 0 });
  });
  it("adds profit, loss and fees per month and keeps the seeded demo dates", () => {
    const acc = buildAccount([
      row({ amount: 15000, meta: { day: 1 } }),
      row({ type: "profit", amount: 6000, meta: { r: 40 } }),
      row({ type: "fee", amount: -150 }),
      row({ type: "loss", amount: -2085, ym: "2026-08-01", meta: { r: -10 } }),
    ], slugOf, "2026-08-01", "2026-09");
    expect(acc.hold.gold).toEqual({ id: "gold", inv: 15000, val: 18765, profit: 3915, fees: 150 });
    expect(acc.ledger).toEqual([
      { ym: "2026-07", bal: 20850, inv: 15000, profit: 6000, fee: 150 },
      { ym: "2026-08", bal: 18765, inv: 15000, profit: -2085, fee: 0 },
    ]);
    expect(acc.events.map((e) => e.t)).toEqual(["in", "pr", "fe", "ls"]);
  });
  it("shows a withdrawal split across holdings as one line", () => {
    const two = new Map([["h1", "gold"], ["h2", "crypto"]]);
    const acc = buildAccount([
      row({ amount: 10000, meta: { day: 1 } }), row({ holding_id: "h2", amount: 5000, meta: { day: 1 } }),
      row({ type: "withdrawal", amount: -2000, ym: "2026-10-01", ref_id: "w1", created_at: "2026-10-21T08:00:00Z", meta: { source: "withdrawal" } }),
      row({ holding_id: "h2", type: "withdrawal", amount: -1000, ym: "2026-10-01", ref_id: "w1", created_at: "2026-10-21T08:00:00Z", meta: { source: "withdrawal" } }),
    ], two, null, "2026-09");
    expect(acc.events.filter((e) => e.t === "out")).toEqual([{ t: "out", ym: "2026-10", day: 21, id: "", amt: -3000 }]);
    expect(acc.hold.gold.val).toBe(8000);
    expect(acc.hold.crypto.val).toBe(4000);
  });
  it("includes the affiliate part of a withdrawal in its one line, outside the holdings", () => {
    const acc = buildAccount([
      row({ amount: 10000, meta: { day: 1 } }),
      row({ holding_id: null, type: "affiliate_commission", amount: 1500, ref_id: "c1" }),
      row({ holding_id: null, type: "affiliate_payout", amount: -1500, ym: "2026-10-01", ref_id: "w2", created_at: "2026-10-21T08:00:00Z" }),
      row({ type: "withdrawal", amount: -500, ym: "2026-10-01", ref_id: "w2", created_at: "2026-10-21T08:00:00Z", meta: { source: "withdrawal" } }),
    ], slugOf, null, "2026-09");
    expect(acc.events.filter((e) => e.t === "out")).toEqual([{ t: "out", ym: "2026-10", day: 21, id: "", amt: -2000 }]);
    expect(acc.hold.gold.val).toBe(9500);
  });
  it("shows an empty account as one zero month", () => {
    expect(buildAccount([], slugOf, null, "2026-09").ledger).toEqual([{ ym: "2026-09", bal: 0, inv: 0, profit: 0, fee: 0 }]);
  });
});
