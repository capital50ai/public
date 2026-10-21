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
  (Rs 162,209.38, identical to the preview). Remove before launch: `select public.purge_demo_data();`

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

## Development

```bash
npm run dev              # local server
npm run gen-seed         # regenerate 0002 from data/records.json
npm run test:db          # migrations twice + RLS/trigger/rate-limit tests on a local Postgres
```
