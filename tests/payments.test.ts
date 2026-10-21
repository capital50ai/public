import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { jazzcashCheckout, jazzcashHash, jazzcashVerify, pkTimestamp } from "../lib/payments/jazzcash";
import { nowpaymentsSignature, nowpaymentsVerify } from "../lib/payments/nowpayments";

describe("JazzCash signature", () => {
  const salt = "s4lt";
  it("hashes salt & values of non-empty pp fields in field-name order", () => {
    const fields = { pp_TxnRefNo: "T1", pp_Amount: "500000", pp_Version: "1.1", pp_SubMerchantID: "", ppmpf_1: "x", other: "ignored" };
    const expected = createHmac("sha256", salt).update("s4lt&500000&T1&1.1&x").digest("hex").toUpperCase();
    expect(jazzcashHash(fields, salt)).toBe(expected);
  });
  it("accepts its own checkout and rejects any change", () => {
    const { fields } = jazzcashCheckout({ mode: "sandbox", merchantId: "MC1", password: "pw", salt, reference: "C50ABC", amountPkr: 15000, returnUrl: "https://x/r" });
    expect(fields.pp_Amount).toBe("1500000");
    expect(jazzcashVerify(fields, salt)).toBe(true);
    expect(jazzcashVerify({ ...fields, pp_Amount: "1" }, salt)).toBe(false);
    expect(jazzcashVerify(fields, "other-salt")).toBe(false);
    expect(jazzcashVerify({ ...fields, pp_SecureHash: "" }, salt)).toBe(false);
  });
  it("formats Pakistan time", () => {
    expect(pkTimestamp(new Date("2026-10-31T19:30:05Z"))).toBe("20261101003005");
  });
});

describe("NOWPayments signature", () => {
  const secret = "ipn-secret";
  const body = { payment_status: "finished", order_id: "C50X", price_amount: 53.57, nested: { b: 1, a: 2 } };
  it("signs the key-sorted JSON with HMAC-SHA512", () => {
    const sorted = '{"nested":{"a":2,"b":1},"order_id":"C50X","payment_status":"finished","price_amount":53.57}';
    expect(nowpaymentsSignature(body, secret)).toBe(createHmac("sha512", secret).update(sorted).digest("hex"));
  });
  it("verifies, and rejects tampering or a missing signature", () => {
    const sig = nowpaymentsSignature(body, secret);
    expect(nowpaymentsVerify({ ...body }, sig, secret)).toBe(true);
    expect(nowpaymentsVerify({ ...body, price_amount: 1 }, sig, secret)).toBe(false);
    expect(nowpaymentsVerify(body, null, secret)).toBe(false);
    expect(nowpaymentsVerify(body, sig, "wrong")).toBe(false);
  });
});

import { accountHint, ibanOK, nameMatch, trc20OK } from "../lib/payouts";

describe("payout account checks", () => {
  it("validates Pakistani IBANs with the mod-97 check digit", () => {
    expect(ibanOK("PK36 SCBL 0000 0011 2345 6702")).toBe(true);
    expect(ibanOK("PK36SCBL0000001123456703")).toBe(false); // one digit changed
    expect(ibanOK("GB82WEST12345698765432")).toBe(false);
  });
  it("validates TRC20 addresses including the checksum", () => {
    expect(trc20OK("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t")).toBe(true); // USDT contract address
    expect(trc20OK("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6u")).toBe(false);
    expect(trc20OK("0x1234")).toBe(false);
  });
  it("matches titles to the CNIC name like the dashboard does", () => {
    expect(nameMatch("Sara Khan", "Sara Khan Ahmed")).toBe(true);
    expect(nameMatch("SARA K. AHMED", "Sara Khan Ahmed")).toBe(true);
    expect(nameMatch("Sara Ali", "Sara Khan Ahmed")).toBe(false);
  });
  it("masks accounts", () => {
    expect(accountHint("03001234567")).toBe("0300 •••• 4567");
  });
});
