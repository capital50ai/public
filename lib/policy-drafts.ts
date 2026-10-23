// Starting drafts for the public policies, written from how the platform actually works.
// They are NOT legal advice: the owner (with a Pakistani lawyer) must review, fill every [BRACKET] and
// publish. Policies with no draft here (terms, custody) need the lawyer to write them.
export const POLICY_DRAFTS: Record<string, string> = {
  contact: `Support: open a ticket from your dashboard (Support). We reply within one business day.
Email: [SUPPORT EMAIL]
Phone / WhatsApp: [SUPPORT NUMBER], [HOURS] Pakistan time.
Registered address: [REGISTERED ADDRESS]

We will never ask for your password, your SMS codes or your full card or account PIN.`,

  deposits: `Deposits start from Rs 5,000 per strategy. Money you deposit during a month starts earning from the first day of the next month.

Bank transfers are credited after two different staff members match your reference against the bank statement. JazzCash and USDT (TRC20) payments are credited when the payment provider confirms them to us directly; returning from the payment page alone never credits a deposit.

Withdrawals start from Rs 1,000 and need a verified identity (CNIC) and an SMS code. Money is only sent to an account in your own verified name. A newly added payout account can be used after 24 hours. Withdrawals above [TWO-APPROVAL LIMIT, e.g. Rs 100,000] need two different approvers.

We aim to pay approved withdrawals within [PAYOUT TIME, e.g. 2 business days]. Withdrawals are paid after the previous month's results are booked.`,

  eligibility: `You must be at least 18, hold a valid Pakistani CNIC, and complete identity verification before withdrawing. One account per person: an identity can only be verified on one account.

We may refuse or close accounts where we cannot verify identity or the source of funds, as anti-money-laundering rules require. Politically exposed persons need enhanced checks.

Available in: [COUNTRIES / PROVINCES].`,

  privacy: `What we collect: your name, mobile number, email and city; for identity checks your CNIC details, CNIC photos, a selfie, occupation, source of funds and income range; your deposits, withdrawals and payout accounts; support messages.

Why: to run your account, to meet anti-money-laundering (AML/CFT) rules, to pay you, and to answer you.

How it is protected: identity documents are stored privately and can only be opened by authorised staff through links that expire after 5 minutes. Payout account numbers and nominee CNICs are encrypted. Photos are re-saved to remove location data. Every staff action on your account is logged.

How long we keep it: identity and transaction records for 5 years after your account closes, as the law requires.

Your rights: download your data at any time (Profile → Download my data), correct your details, or ask us to close your account (Profile → Close account). We do not sell your data. Service providers that process data for us: [LIST: hosting, SMS, payment providers].

Data controller: Capital 50 AI, [REGISTERED ADDRESS]. Contact: [PRIVACY EMAIL].`,

  complaints: `To complain, open a ticket in your dashboard (Support) with the category that fits, or email [COMPLAINTS EMAIL]. You'll get a ticket number straight away.

We acknowledge complaints within 1 business day and aim to resolve them within [DAYS] business days. If a complaint is about money, we review the full record of your account (every deposit, result, fee and withdrawal is logged and cannot be edited).

If you are not satisfied with our answer, you can escalate to [ESCALATION BODY / REGULATOR].`,
};
