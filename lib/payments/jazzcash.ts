import { createHmac, timingSafeEqual } from "node:crypto";

// JazzCash hosted checkout ("Page Redirection", v1.1).
export const JAZZCASH_URL = {
  sandbox: "https://sandbox.jazzcash.com.pk/CustomerPortal/transactionmanagement/merchantform/",
  live: "https://payments.jazzcash.com.pk/CustomerPortal/transactionmanagement/merchantform/",
};

// pp_SecureHash: HMAC-SHA256 keyed with the integrity salt over
// salt & (values of every non-empty pp* field except pp_SecureHash, ordered by field name), upper-case hex.
export function jazzcashHash(fields: Record<string, unknown>, salt: string): string {
  const keys = Object.keys(fields)
    .filter((k) => k.toLowerCase().startsWith("pp") && k !== "pp_SecureHash" && fields[k] != null && String(fields[k]) !== "")
    .sort();
  const message = [salt, ...keys.map((k) => String(fields[k]))].join("&");
  return createHmac("sha256", salt).update(message, "utf8").digest("hex").toUpperCase();
}

export function jazzcashVerify(fields: Record<string, unknown>, salt: string): boolean {
  const given = String(fields.pp_SecureHash ?? "").toUpperCase();
  const expected = jazzcashHash(fields, salt);
  return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

// yyyyMMddHHmmss in Pakistan time.
export function pkTimestamp(d: Date): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(d).map((x) => [x.type, x.value]),
  );
  return `${p.year}${p.month}${p.day}${p.hour}${p.minute}${p.second}`;
}

export function jazzcashCheckout(o: {
  mode: "sandbox" | "live"; merchantId: string; password: string; salt: string;
  reference: string; amountPkr: number; returnUrl: string; now?: Date;
}) {
  const now = o.now ?? new Date();
  const fields: Record<string, string> = {
    pp_Version: "1.1",
    pp_TxnType: "",
    pp_Language: "EN",
    pp_MerchantID: o.merchantId,
    pp_SubMerchantID: "",
    pp_Password: o.password,
    pp_BankID: "",
    pp_ProductID: "",
    pp_TxnRefNo: o.reference,
    pp_Amount: String(Math.round(o.amountPkr * 100)), // paisa
    pp_TxnCurrency: "PKR",
    pp_TxnDateTime: pkTimestamp(now),
    pp_BillReference: "deposit",
    pp_Description: "Capital 50 AI deposit",
    pp_TxnExpiryDateTime: pkTimestamp(new Date(now.getTime() + 60 * 60 * 1000)),
    pp_ReturnURL: o.returnUrl,
    ppmpf_1: "", ppmpf_2: "", ppmpf_3: "", ppmpf_4: "", ppmpf_5: "",
  };
  fields.pp_SecureHash = jazzcashHash(fields, o.salt);
  return { url: JAZZCASH_URL[o.mode], fields };
}
