# Capital 50 AI

Investor platform for Capital 50 AI. The UI is the owner-approved design in `templates/`
(public site, login/sign-up, dashboard), served unchanged by `app/p/[page]/route.ts`.
The server fills in the strategy returns from the `strategy_returns` table.

## Status: Phase 1 (Foundation)

- Supabase schema: `profiles`, `strategies`, `strategy_returns`, `audit_log`, `rate_limits`, with RLS.
- Six strategies and every published monthly return, seeded from `data/records.json`.
- Real auth: phone or email + password login, sign-up with SMS code, forgot password → code → new password, logout.
- Dashboard requires a login and shows the user's own name, mobile, email, invite code and member-since date.
  Balances and members are still sample data until Phase 2.
- Referral codes generated per user; `?ref=CODE` is stored at sign-up (self-referral blocked).
- Rate limits: 5 logins per 15 min per number/email (20 per IP), 3 SMS codes per hour per number.
- Audit log of sign-ups, logins, reset codes and password changes (append-only).

## Phase 2 (read-only dashboard)

- `holdings`, append-only `ledger_entries` (balances are sums of it), `month_closes`.
- `close_month(ym)`: profit = round(value × return%, 2), fee = round(max(0, profit) × 2.5%, 2);
  idempotent (re-running is a no-op), months close in order, needs a *published* return.
- Dashboard overview, strategies, wallet, transaction history and statements read the user's ledger.
- Demo account holds the preview's sample deposits with real closes for Jul–Sep 2026
  (Rs 162,209.38, identical to the preview). Remove before launch: Staff → Settings → Launch checklist.

## Phase 3 (identity verification)

- `kyc_applications` (history kept), `kyc_documents`, private `kyc` storage bucket, `staff_members`.
- Investors complete the dashboard's 5 KYC steps; each step is validated on the server (CNIC format,
  18+, unexpired CNIC, one CNIC per person). Files are type-checked by content, max 5 MB, and photos are
  re-encoded to drop EXIF/GPS. Only the server touches the bucket.
- Staff log in at `/admin/login` (email + password + authenticator code, required). Owner/compliance
  approve or reject (reason required) at `/admin/kyc`; documents open via 5-minute signed links.
  Approval locks the profile name to the CNIC name. Every decision is in the audit log.
- Add a staff member: create an email login in Supabase (Authentication → Users → Add user), then
  `select public.grant_staff('email@example.com', 'owner');` (owner | compliance | finance | support).
- Manual review until a KYC provider (NADRA check, liveness) is connected; `provider_ref`/`provider_result`
  are ready for its webhook.

## Phase 4 (money in, test mode)

- `deposits`, append-only `payment_events`, `app_settings` (company bank account).
- `credit_deposit()` is the only way money is added: once per deposit, ledger entry dated the month
  after payment (brief §5.1 rule 6, `deposit_effective_ym`), audit-logged. Replays are no-ops.
- Bank transfer: investor gets a `C50-XXXXXX` reference; two different owner/finance staff confirm the
  same bank-statement reference at `/admin/deposits`; the second confirmation credits it.
- JazzCash (hosted checkout): credited only from the signed IPN at `/api/webhooks/jazzcash`; the browser
  return page never credits.
- USDT TRC20 via NOWPayments: invoice priced in USD at `USDT_PKR_RATE` (stored per deposit), credited only
  on a signed `finished` IPN at `/api/webhooks/nowpayments` for the exact invoice amount.
- Easypaisa: shown as "soon" until a merchant account and its integration documents are available.
- `PAYMENTS_MODE` defaults to `sandbox` (test endpoints, test bank account). Set `live` only after sign-off.
- Env: `JAZZCASH_MERCHANT_ID`, `JAZZCASH_PASSWORD`, `JAZZCASH_INTEGRITY_SALT`, `NOWPAYMENTS_API_KEY`,
  `NOWPAYMENTS_IPN_SECRET`, `USDT_PKR_RATE`. A method stays "soon" until its keys are set.
- Live bank account: `update app_settings set value = '{"bank":"…","title":"…","iban":"PK…"}' where key = 'bank_account';`

## Backend switch

Until `C50_BACKEND=live` is set, the site runs in **preview mode**: the original front-end behaviour, with
returns taken from the bundled records. This keeps the shared demo link working while Supabase is being connected.

## Going live (one time)

1. **Supabase → SQL Editor:** paste all of `supabase/setup.sql` and press Run. It creates the tables,
   loads the returns and creates the demo account. Re-running it is safe.
   (After changing a migration, regenerate it with `npm run build-setup-sql`.)
2. **Supabase → Authentication → Sign In / Providers → Phone:** enable it and choose an SMS provider
   (Twilio works for Pakistan). Keep "Confirm phone" on.
3. **Vercel → Project → Settings → Environment Variables** (Production):
   - `NEXT_PUBLIC_SUPABASE_URL`: Project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: publishable key
   - `SUPABASE_SERVICE_ROLE_KEY`: secret key (server only)
   - `C50_BACKEND` = `live`

   Then redeploy.
4. Demo account (created by `setup.sql`): mobile 300 1234567, password `Demo#2026`.
   `scripts/create-demo-user.mjs` can reset it from a machine that can reach Supabase.

## Phase 5 (money out)

- `payout_methods` (account numbers AES-256-GCM encrypted with `C50_DATA_KEY`; investors only ever see a
  masked hint), `withdrawals`, setting `withdrawal_two_approvals_above` (default 100000).
- Adding a method needs a verified KYC; the title must match the CNIC name; IBANs are mod-97 checked,
  TRC20 addresses checksum-checked; usable after 24 hours.
- `request_withdrawal()` re-checks KYC, method age/name, Rs 1,000 minimum, available balance (ledger minus
  withdrawals in review) and an SMS code verified within 10 minutes; the amount is reserved at once.
- Staff (`/admin/withdrawals`, owner/finance): approve (two different people above the threshold), reject
  with a reason (shown to the investor), mark paid with a transaction reference. `pay_withdrawal()` writes the
  ledger, split across holdings by value, dated the current month; it waits until last month is closed.

## Phase 6 (affiliates)

- Invite links are `/r/CODE`: the first link opened is remembered for 30 days and wins at sign-up.
  Investors can change their code (4–12 letters/numbers); old codes keep pointing to them.
- Commission is company money, never taken from a member:
  - fee share: `affiliate_fee_share_rate` (default 15%) of the 2.5% fee on a member's monthly profit,
    credited inside `close_month()`;
  - deposit commission: `affiliate_deposit_rate` (default 0% = off, max 10%) of each member deposit,
    pending until the deposit's first month closes, cancelled if the member withdraws before then.
- Self-referrals (same verified CNIC) and blocked affiliates earn nothing. Staff can void a commission;
  a credited one is reversed with a new ledger entry.
- The affiliate hub, leaderboard (from credited commissions only; names only if the affiliate opts in)
  and every place the page states the terms follow the owner's rates.
- Affiliate earnings are withdrawn with the normal withdrawal flow (paid out before investments).

## Phase 7 (staff admin panel)

`/admin` (email + password + authenticator). Every action is role-checked in the database and audit-logged.

| Section | Who | What |
|---|---|---|
| Overview | all staff | totals, queues, daily reconciliation result |
| Returns | owner, compliance (owner publishes) | month-to-date / published returns with a source note; preview and close a month (owner) |
| Investors | all staff (freeze: owner, compliance) | search, full account view, freeze, block affiliate |
| Identity checks, Deposits, Withdrawals | as before | |
| Affiliates | all staff (void: owner, compliance, finance) | top affiliates, commissions, void |
| Tickets | all staff | investor support inbox and replies |
| Audit log | owner, compliance | every recorded action, filterable |
| Settings | owner | commission rates, two-approval limit, bank account, staff, launch checklist |

- Daily reconciliation (`run_reconciliation()`): deposits, withdrawals, commissions and month closes are
  each checked against the ledger; every fee is 2.5% of profit; no negative balances. Runs from Vercel Cron
  (`/api/cron/reconcile`, needs `CRON_SECRET`) and from the Overview page.
- Investors: change password (current password + SMS code; other devices are logged out), log out other
  devices, edit email/city, nominee (CNIC encrypted), download my data, account closure request (a ticket).
- Launch: Settings → remove the demo account, then "Reset all test money" (refuses if any live-mode
  payment exists; accounts, identity checks and payout methods stay).
- Security headers on every page: HSTS, no framing, nosniff, referrer and permissions policies.

## Phase 7b (hardening)

- SMS code (to the investor's own number) for: withdrawals, adding a payout method, changing email,
  changing password, and — with `LOGIN_NEW_DEVICE_CODE=on` — logging in from a new browser. A browser
  that passed a code is remembered for a year (`trusted_devices`, only a hash is stored). Keep the switch
  off until real SMS (Twilio) is connected, then set it to `on` in Vercel.
- Notifications are written by database triggers when something real happens: deposit credited/failed,
  withdrawal approved/sent/rejected, identity verified/rejected, commission credited, new member, support
  reply, and each investor's own result when a month is closed. The Profile alert switches apply.
  `sms_sent_at`/`email_sent_at` are ready for an SMS/email sender.
- Public policies: Staff → Policies. Factual drafts are provided; publishing is blocked while any
  [BRACKET] is left. Until published, the home page says "Not yet published". Have them reviewed by a lawyer.

## Page delivery (mobile speed)

`scripts/build-assets.mjs` runs before every build: it splits each template into a small HTML shell
(`templates/dist/`, filled per request) and content-hashed files in `public/assets/` cached for a year.
Per-visit downloads: dashboard 573 KB -> ~38 KB, home 1.1 MB -> ~20 KB, login 79 KB -> ~14 KB.
The dashboard's server reads (login, profile, KYC, balances) run in one parallel round trip.

## Development

```bash
npm run dev              # local server
npm run gen-seed         # regenerate 0002 from data/records.json
npm run test:db          # migrations twice + SQL tests for every phase on a local Postgres
npm test                 # unit tests (payment signatures, account builder)
```
