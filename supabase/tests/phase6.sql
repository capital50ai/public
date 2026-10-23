-- Phase 6 checks: brief §11 tests 1 (commission 22.50), 3 (leaderboard = credited commissions), 9 (self-referral),
-- deposit commissions, codes, void, block, freeze, affiliate payouts.
\set ON_ERROR_STOP on

create or replace function pg_temp.deposit(p_user uuid, p_slug text, p_amt numeric, p_ym date) returns void language plpgsql as $$
declare v_h uuid; begin
  insert into public.holdings (user_id, strategy_id) select p_user, id from public.strategies where slug = p_slug on conflict (user_id, strategy_id) do nothing;
  select h.id into v_h from public.holdings h join public.strategies s on s.id = h.strategy_id where h.user_id = p_user and s.slug = p_slug;
  insert into public.ledger_entries (user_id, holding_id, type, amount, ym, idempotency_key) values (p_user, v_h, 'deposit', p_amt, p_ym, 'test:' || gen_random_uuid());
end $$;

begin;
insert into auth.users (id, phone, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c1', '923000000501', null, '{"full_name":"Asad Malik"}'),
  ('00000000-0000-0000-0000-0000000000f1', null, 'owner@c50.test', '{}');
select public.grant_staff('owner@c50.test', 'owner');
-- codes: invalid / reserved / own change keeps the old code working
do $$ declare old text; begin
  select referral_code into old from public.profiles where user_id = '00000000-0000-0000-0000-0000000000c1';
  begin perform public.set_referral_code('00000000-0000-0000-0000-0000000000c1', 'ab'); raise exception 'short code';
  exception when raise_exception then if sqlerrm = 'short code' then raise; end if; end;
  begin perform public.set_referral_code('00000000-0000-0000-0000-0000000000c1', 'admin'); raise exception 'reserved code';
  exception when raise_exception then if sqlerrm = 'reserved code' then raise; end if; assert sqlerrm like 'That code is reserved%', sqlerrm; end;
  assert public.set_referral_code('00000000-0000-0000-0000-0000000000c1', 'asad2026') = 'ASAD2026', 'set code';
  perform set_config('test.old_code', old, true);
end $$;
-- members: one with the new code, one with the old code, one self-referral (same CNIC later)
insert into auth.users (id, phone, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c2', '923000000502', '{"full_name":"Bilal Ahmed","ref":"asad2026"}');
insert into auth.users (id, phone, raw_user_meta_data) select
  '00000000-0000-0000-0000-0000000000c3', '923000000503', jsonb_build_object('full_name', 'Danish Iqbal', 'ref', current_setting('test.old_code'));
insert into auth.users (id, phone, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c4', '923000000504', '{"full_name":"Asad Second","ref":"ASAD2026"}');
do $$ declare n int; begin
  select count(*) into n from public.profiles where referred_by = (select id from public.profiles where user_id = '00000000-0000-0000-0000-0000000000c1');
  assert n = 3, 'referred by new and old code: ' || n;
  begin perform public.set_referral_code('00000000-0000-0000-0000-0000000000c2', current_setting('test.old_code')); raise exception 'took an old code';
  exception when raise_exception then if sqlerrm = 'took an old code' then raise; end if; assert sqlerrm like 'That code is taken%', sqlerrm; end;
end $$;
-- brief test 1: gold +40% on 15,000 -> fee 150 -> commission 22.50; re-run changes nothing
select pg_temp.deposit('00000000-0000-0000-0000-0000000000c2', 'gold', 15000, '2026-09-01');
select pg_temp.deposit('00000000-0000-0000-0000-0000000000c3', 'gold', 10000, '2026-09-01');
do $$ declare n int; v numeric; begin
  perform public.close_month('2026-09-01');
  select commission_amount into v from public.affiliate_commissions where member_id = '00000000-0000-0000-0000-0000000000c2';
  assert v = 22.50, 'commission ' || v;
  select sum(amount) into v from public.ledger_entries where user_id = '00000000-0000-0000-0000-0000000000c1' and type = 'affiliate_commission';
  assert v = 37.50, 'affiliate ledger (22.50 + 15.00) ' || v;
  perform public.close_month('2026-09-01');
  select count(*) into n from public.affiliate_commissions; assert n = 2, 'commissions after re-run ' || n;
  -- brief test 3: leaderboard = credited commissions
  select commission into v from public.affiliate_leaderboard('2000-01-01') where user_id = '00000000-0000-0000-0000-0000000000c1';
  assert v = 37.50, 'leaderboard ' || v;
  assert (select display_name from public.affiliate_leaderboard('2000-01-01')) like 'Affiliate #%', 'anonymous by default';
  update public.profiles set leaderboard_opt_in = true where user_id = '00000000-0000-0000-0000-0000000000c1';
  assert (select display_name from public.affiliate_leaderboard('2000-01-01')) = 'Asad M.', 'opt-in name';
  -- the hub summary: masked names, own row labelled, nothing about member balances
  declare j jsonb := public.affiliate_summary('00000000-0000-0000-0000-0000000000c1'); begin
    assert (j->>'total')::numeric = 37.50, 'summary total ' || (j->>'total');
    assert (j->>'withdrawable')::numeric = 37.50, 'summary withdrawable ' || (j->>'withdrawable');
    assert jsonb_array_length(j->'members') = 3, 'summary members';
    assert (select count(*) from jsonb_array_elements(j->'members') x where x->>'n' = 'Bilal A.' and (x->>'com')::numeric = 22.50 and x->>'id' = 'gold') = 1, 'member row ' || (j->'members')::text;
    assert (select count(*) from jsonb_array_elements(j->'members') x where x ? 'amt' or x ? 'val') = 0, 'member balances leaked';
    assert j->'lb'->'all'->0->>'name' = 'You · ASAD2026' and (j->'lb'->'all'->0->>'you')::boolean, 'own leaderboard row ' || (j->'lb'->'all')::text;
    assert (j->'byMonth'->>'2026-09')::numeric = 37.50, 'by month';
    assert (j->'rates'->>'fee')::numeric = 0.15 and (j->'rates'->>'dep')::numeric = 0, 'rates';
    j := public.affiliate_summary('00000000-0000-0000-0000-0000000000c2');
    assert (j->'lb'->'all'->-1->>'you')::boolean and (j->'lb'->'all'->-1->>'com')::numeric = 0 and (j->'lb'->'all'->-1->>'rank')::int = 2, 'non-earner row ' || (j->'lb'->'all')::text;
  end;
  -- void a credited commission: reversing adjustment, leaderboard drops it
  perform public.void_commission((select id from public.affiliate_commissions where member_id = '00000000-0000-0000-0000-0000000000c3'), '00000000-0000-0000-0000-0000000000f1', 'Duplicate account found');
  assert public.ledger_balance('00000000-0000-0000-0000-0000000000c1') = 22.50, 'balance after void';
  assert (select commission from public.affiliate_leaderboard('2000-01-01')) = 22.50, 'leaderboard after void';
end $$;
rollback;

-- brief test 9: self-referral (same verified CNIC) earns nothing; blocked affiliates earn nothing
begin;
insert into auth.users (id, phone, raw_user_meta_data) values ('00000000-0000-0000-0000-0000000000c1', '923000000501', '{"full_name":"Asad Malik"}');
update public.profiles set referral_code = 'ASADX1' where user_id = '00000000-0000-0000-0000-0000000000c1';
insert into public.affiliate_codes values ('ASADX1', '00000000-0000-0000-0000-0000000000c1');
insert into auth.users (id, phone, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c4', '923000000504', '{"full_name":"Asad Alt","ref":"ASADX1"}'),
  ('00000000-0000-0000-0000-0000000000c5', '923000000505', '{"full_name":"Farah Noor","ref":"ASADX1"}');
insert into public.kyc_applications (user_id, status, cnic_hash) values ('00000000-0000-0000-0000-0000000000c1', 'verified', 'cnic-asad');
insert into public.kyc_applications (user_id, status, cnic_hash) values ('00000000-0000-0000-0000-0000000000c4', 'rejected', 'cnic-asad');
update public.kyc_applications set status = 'verified' where user_id = '00000000-0000-0000-0000-0000000000c1';
drop index if exists public.kyc_applications_cnic_once;  -- simulate a duplicate account slipping past KYC
update public.kyc_applications set status = 'verified' where user_id = '00000000-0000-0000-0000-0000000000c4';
select pg_temp.deposit('00000000-0000-0000-0000-0000000000c4', 'gold', 15000, '2026-09-01');
select pg_temp.deposit('00000000-0000-0000-0000-0000000000c5', 'gold', 15000, '2026-09-01');
do $$ declare n int; begin
  perform public.close_month('2026-09-01');
  assert (select status from public.affiliate_commissions where member_id = '00000000-0000-0000-0000-0000000000c4') = 'void', 'self-referral not void';
  assert (select status from public.affiliate_commissions where member_id = '00000000-0000-0000-0000-0000000000c5') = 'credited', 'normal member';
  assert public.ledger_balance('00000000-0000-0000-0000-0000000000c1') = 22.50, 'only the real member pays';
end $$;
rollback;

begin;
insert into auth.users (id, phone, raw_user_meta_data) values ('00000000-0000-0000-0000-0000000000c1', '923000000501', '{"full_name":"Asad Malik"}');
update public.profiles set referral_code = 'ASADX1', affiliate_blocked_at = now() where user_id = '00000000-0000-0000-0000-0000000000c1';
insert into public.affiliate_codes values ('ASADX1', '00000000-0000-0000-0000-0000000000c1');
insert into auth.users (id, phone, raw_user_meta_data) values ('00000000-0000-0000-0000-0000000000c5', '923000000505', '{"full_name":"Farah Noor","ref":"ASADX1"}');
select pg_temp.deposit('00000000-0000-0000-0000-0000000000c5', 'gold', 15000, '2026-09-01');
do $$ begin
  perform public.close_month('2026-09-01');
  assert not exists (select 1 from public.affiliate_commissions), 'blocked affiliate earned';
end $$;
rollback;

-- deposit commissions: off by default; at 2% pending, credited when the first month closes, void if withdrawn first
begin;
insert into auth.users (id, phone, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c1', '923000000501', null, '{"full_name":"Asad Malik"}'),
  ('00000000-0000-0000-0000-0000000000f1', null, 'owner@c50.test', '{}');
update public.profiles set referral_code = 'ASADX1' where user_id = '00000000-0000-0000-0000-0000000000c1';
insert into public.affiliate_codes values ('ASADX1', '00000000-0000-0000-0000-0000000000c1');
insert into auth.users (id, phone, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c5', '923000000505', '{"full_name":"Farah Noor","ref":"ASADX1"}'),
  ('00000000-0000-0000-0000-0000000000c6', '923000000506', '{"full_name":"Gul Khan","ref":"ASADX1"}');
insert into public.deposits (id, user_id, strategy_id, amount, method, reference) select '00000000-0000-0000-0000-00000000de11', '00000000-0000-0000-0000-0000000000c5', id, 10000, 'bank', 'C50-T11' from public.strategies where slug = 'gold';
insert into public.deposits (id, user_id, strategy_id, amount, method, reference) select '00000000-0000-0000-0000-00000000de12', '00000000-0000-0000-0000-0000000000c5', id, 20000, 'bank', 'C50-T12' from public.strategies where slug = 'gold';
insert into public.deposits (id, user_id, strategy_id, amount, method, reference) select '00000000-0000-0000-0000-00000000de13', '00000000-0000-0000-0000-0000000000c6', id, 50000, 'bank', 'C50-T13' from public.strategies where slug = 'gold';
do $$ declare v numeric; begin
  perform public.credit_deposit('00000000-0000-0000-0000-00000000de11', null, 'test', 'T11');
  assert not exists (select 1 from public.affiliate_commissions), 'deposit commission while rate is 0';
  update public.app_settings set value = '0.02' where key = 'affiliate_deposit_rate';
  perform public.credit_deposit('00000000-0000-0000-0000-00000000de12', null, 'test', 'T12');
  perform public.credit_deposit('00000000-0000-0000-0000-00000000de13', null, 'test', 'T13');
  assert (select commission_amount from public.affiliate_commissions where source_id = '00000000-0000-0000-0000-00000000de12') = 400, '2% of 20,000';
  assert public.ledger_balance('00000000-0000-0000-0000-0000000000c1') = 0, 'credited before the first month closed';
  -- member c6 asks to withdraw before the month closes
  insert into public.payout_methods (id, user_id, type, account_enc, account_hint, account_hash, title, title_verified, ready_at)
    values ('00000000-0000-0000-0000-00000000ee21', '00000000-0000-0000-0000-0000000000c6', 'jazz', 'x', 'x', 'h21', 'Gul Khan', true, now() - interval '2 days');
  insert into public.withdrawals (user_id, payout_method_id, amount, needs_approvals, otp_verified_at)
    values ('00000000-0000-0000-0000-0000000000c6', '00000000-0000-0000-0000-00000000ee21', 50000, 1, now());
  perform public.affiliate_settle_deposits(public.deposit_effective_ym(now()));
  assert (select status from public.affiliate_commissions where source_id = '00000000-0000-0000-0000-00000000de12') = 'credited', 'kept deposit';
  assert (select status from public.affiliate_commissions where source_id = '00000000-0000-0000-0000-00000000de13') = 'void', 'withdrawn deposit';
  assert public.ledger_balance('00000000-0000-0000-0000-0000000000c1') = 400, 'affiliate balance ' || public.ledger_balance('00000000-0000-0000-0000-0000000000c1');
end $$;
rollback;

-- affiliate earnings are paid out before investments; frozen accounts can't withdraw
begin;
insert into auth.users (id, phone, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c7', '923000000507', null, '{"full_name":"Hina Shah"}'),
  ('00000000-0000-0000-0000-0000000000f1', null, 'owner@c50.test', '{}');
select public.grant_staff('owner@c50.test', 'owner');
insert into public.kyc_applications (user_id, status) values ('00000000-0000-0000-0000-0000000000c7', 'verified');
select pg_temp.deposit('00000000-0000-0000-0000-0000000000c7', 'gold', 10000, '2026-09-01');
insert into public.ledger_entries (user_id, type, amount, ym, idempotency_key) values ('00000000-0000-0000-0000-0000000000c7', 'affiliate_commission', 1500, '2026-09-01', 't:aff');
insert into public.payout_methods (id, user_id, type, account_enc, account_hint, account_hash, title, title_verified, ready_at)
  values ('00000000-0000-0000-0000-00000000ee22', '00000000-0000-0000-0000-0000000000c7', 'jazz', 'x', 'x', 'h22', 'Hina Shah', true, now() - interval '2 days');
do $$ declare w uuid; v numeric; begin
  perform public.close_month('2026-09-01');
  w := public.request_withdrawal('00000000-0000-0000-0000-0000000000c7', '00000000-0000-0000-0000-00000000ee22', 2000, now());
  perform public.approve_withdrawal(w, '00000000-0000-0000-0000-0000000000f1');
  perform public.pay_withdrawal(w, '00000000-0000-0000-0000-0000000000f1', 'TXAFF001');
  select sum(amount) into v from public.ledger_entries where ref_id = w::text and type = 'affiliate_payout'; assert v = -1500, 'affiliate part ' || v;
  select sum(amount) into v from public.ledger_entries where ref_id = w::text and type = 'withdrawal'; assert v = -500, 'holding part ' || v;
  perform public.set_account_flag('00000000-0000-0000-0000-0000000000c7', '00000000-0000-0000-0000-0000000000f1', 'freeze', true, 'Suspicious login reported');
  begin perform public.request_withdrawal('00000000-0000-0000-0000-0000000000c7', '00000000-0000-0000-0000-00000000ee22', 1000, now()); raise exception 'frozen withdrew';
  exception when raise_exception then if sqlerrm = 'frozen withdrew' then raise; end if; assert sqlerrm like 'Your account is on hold%', sqlerrm; end;
end $$;
-- RLS: own commissions and codes only
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c7', true);
do $$ declare n int; begin
  select count(*) into n from public.affiliate_codes; assert n = 1, 'sees ' || n || ' codes';
  assert (public.my_affiliate_summary()->>'withdrawable')::numeric = 0, 'own summary';
  begin perform public.set_referral_code('00000000-0000-0000-0000-0000000000c7', 'HACKED'); raise exception 'code callable';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
\echo PHASE 6 AFFILIATE TESTS PASSED
