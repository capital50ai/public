-- Phase 5 checks: brief §11 tests 4 (withdrawal refusals) and 5 (two distinct approvers), payout ledger, RLS.
\set ON_ERROR_STOP on
begin;
insert into auth.users (id, phone, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000b1', '923000000401', null, '{"full_name":"Wahid Ali"}'),
  ('00000000-0000-0000-0000-0000000000b2', '923000000402', null, '{"full_name":"Not Verified"}'),
  ('00000000-0000-0000-0000-0000000000f1', null, 'owner@c50.test', '{}'),
  ('00000000-0000-0000-0000-0000000000f2', null, 'finance@c50.test', '{}'),
  ('00000000-0000-0000-0000-0000000000f3', null, 'support@c50.test', '{}');
select public.grant_staff('owner@c50.test', 'owner'), public.grant_staff('finance@c50.test', 'finance'), public.grant_staff('support@c50.test', 'support');
insert into public.kyc_applications (user_id, status, personal) values
  ('00000000-0000-0000-0000-0000000000b1', 'verified', '{"fullName":"Wahid Ali Khan"}');
-- 150,000 across two strategies, earning since September; September closed
insert into public.holdings (id, user_id, strategy_id) select '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', id from public.strategies where slug = 'gold';
insert into public.holdings (id, user_id, strategy_id) select '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000b1', id from public.strategies where slug = 'crypto';
insert into public.ledger_entries (user_id, holding_id, type, amount, ym, idempotency_key) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'deposit', 100000, '2026-09-01', 't:d1'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a2', 'deposit', 50000, '2026-09-01', 't:d2');
insert into public.payout_methods (id, user_id, type, account_enc, account_hint, account_hash, title, title_verified, ready_at) values
  ('00000000-0000-0000-0000-00000000ee01', '00000000-0000-0000-0000-0000000000b1', 'jazz', 'x', '0300 •••• 4567', 'h1', 'Wahid Ali', true, now() - interval '1 day'),
  ('00000000-0000-0000-0000-00000000ee02', '00000000-0000-0000-0000-0000000000b1', 'bank', 'x', 'PK36 •••• 0001', 'h2', 'Wahid Ali', true, now() + interval '20 hours'),
  ('00000000-0000-0000-0000-00000000ee03', '00000000-0000-0000-0000-0000000000b1', 'easy', 'x', '0345 •••• 1111', 'h3', 'Someone Else', false, now() - interval '1 day'),
  ('00000000-0000-0000-0000-00000000ee04', '00000000-0000-0000-0000-0000000000b2', 'jazz', 'x', '0311 •••• 2222', 'h4', 'Not Verified', true, now() - interval '1 day');

create or replace function pg_temp.refused(p_user uuid, p_method uuid, p_amount numeric, p_otp timestamptz, p_like text) returns void language plpgsql as $$
begin
  perform public.request_withdrawal(p_user, p_method, p_amount, p_otp);
  raise exception 'NOT REFUSED: % %', p_amount, p_like;
exception when raise_exception then
  if sqlerrm like 'NOT REFUSED%' then raise; end if;
  if sqlerrm not like p_like then raise exception 'wrong refusal: "%" (wanted %)', sqlerrm, p_like; end if;
end $$;

do $$ declare w1 uuid; w2 uuid; r jsonb; n int; v numeric; ok uuid := '00000000-0000-0000-0000-00000000ee01'; me uuid := '00000000-0000-0000-0000-0000000000b1'; begin
  perform public.close_month('2026-09-01');
  -- brief §11 test 4: each refusal
  perform pg_temp.refused('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-00000000ee04', 5000, now(), 'Verify your identity%');
  perform pg_temp.refused(me, '00000000-0000-0000-0000-00000000ee02', 5000, now(), 'This payout method unlocks at%');
  perform pg_temp.refused(me, '00000000-0000-0000-0000-00000000ee03', 5000, now(), '%not in your verified name%');
  perform pg_temp.refused(me, ok, 999, now(), 'Minimum withdrawal is Rs 1,000%');
  perform pg_temp.refused(me, ok, 10000000, now(), '%more than your available balance%');
  perform pg_temp.refused(me, ok, 5000, null, 'Confirm with the code%');
  perform pg_temp.refused(me, ok, 5000, now() - interval '11 minutes', 'Confirm with the code%');
  perform pg_temp.refused(me, '00000000-0000-0000-0000-00000000ee04', 5000, now(), 'Choose one of your payout methods%');

  -- reserved amounts: 120k requested leaves 30k + Sept profit available
  v := public.ledger_balance(me);
  w1 := public.request_withdrawal(me, ok, 120000, now());
  assert public.available_to_withdraw(me) = v - 120000, 'reservation';
  perform pg_temp.refused(me, ok, v - 120000 + 1, now(), '%more than your available balance%');
  w2 := public.request_withdrawal(me, ok, 2000, now());
  perform public.cancel_withdrawal(me, w2);
  assert public.available_to_withdraw(me) = v - 120000, 'cancel releases';

  -- brief §11 test 5: over 100,000 needs two different approvers; support can't approve
  begin perform public.approve_withdrawal(w1, '00000000-0000-0000-0000-0000000000f3'); raise exception 'support approved';
  exception when raise_exception then if sqlerrm = 'support approved' then raise; end if; end;
  r := public.approve_withdrawal(w1, '00000000-0000-0000-0000-0000000000f1');
  assert r->>'status' = 'requested' and (r->>'needed')::int = 2, 'one approval ' || r;
  begin perform public.approve_withdrawal(w1, '00000000-0000-0000-0000-0000000000f1'); raise exception 'same approver twice';
  exception when raise_exception then if sqlerrm = 'same approver twice' then raise; end if;
    assert sqlerrm like 'A second, different staff member%', sqlerrm; end;
  begin perform public.pay_withdrawal(w1, '00000000-0000-0000-0000-0000000000f1', 'TX123456'); raise exception 'paid before approval';
  exception when raise_exception then if sqlerrm = 'paid before approval' then raise; end if; end;
  r := public.approve_withdrawal(w1, '00000000-0000-0000-0000-0000000000f2');
  assert r->>'status' = 'approved', 'two approvals ' || r;

  -- pay: split by value across holdings, dated this month, total exact; paying again is a no-op
  r := public.pay_withdrawal(w1, '00000000-0000-0000-0000-0000000000f2', 'jc tx 123456');
  assert r->>'status' = 'paid', 'pay ' || r;
  select count(*), sum(amount) into n, v from public.ledger_entries where ref_id = w1::text;
  assert n = 2 and v = -120000, 'payout ledger ' || n || ' rows ' || v;
  select count(*) into n from public.ledger_entries where ref_id = w1::text
    and ym = date_trunc('month', now() at time zone 'Asia/Karachi')::date; assert n = 2, 'payout month';
  assert (public.pay_withdrawal(w1, '00000000-0000-0000-0000-0000000000f2', 'JCTX123456')->>'already')::boolean, 'pay replay';
  select count(*) into n from public.ledger_entries where ref_id = w1::text; assert n = 2, 'pay replay wrote rows';
  assert public.available_to_withdraw(me) = public.ledger_balance(me), 'nothing reserved after paying';
  select count(*) into n from public.holdings h where h.user_id = me
    and (select sum(amount) from public.ledger_entries where holding_id = h.id) < 0; assert n = 0, 'a holding went negative';

  -- small withdrawal: one approval; the same bank reference can't pay twice
  w2 := public.request_withdrawal(me, ok, 1000, now());
  r := public.approve_withdrawal(w2, '00000000-0000-0000-0000-0000000000f1'); assert r->>'status' = 'approved', 'single approval ' || r;
  begin perform public.pay_withdrawal(w2, '00000000-0000-0000-0000-0000000000f1', 'JCTX123456'); raise exception 'tx ref reused';
  exception when raise_exception then if sqlerrm = 'tx ref reused' then raise; end if; end;
  perform public.reject_withdrawal(w2, '00000000-0000-0000-0000-0000000000f1', 'Wallet number inactive, please add another');
  select count(*) into n from public.audit_log where action like 'withdrawal.%'; assert n = 9, 'withdrawal audit rows ' || n;
end $$;

rollback;

-- payouts wait for last month's close
begin;
insert into auth.users (id, phone, raw_user_meta_data) values ('00000000-0000-0000-0000-0000000000b3', '923000000403', '{"full_name":"Late Close"}'),
  ('00000000-0000-0000-0000-0000000000f2', null, '{}');
update auth.users set email = 'finance@c50.test' where id = '00000000-0000-0000-0000-0000000000f2';
select public.grant_staff('finance@c50.test', 'finance');
insert into public.kyc_applications (user_id, status) values ('00000000-0000-0000-0000-0000000000b3', 'verified');
insert into public.holdings (id, user_id, strategy_id) select '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000b3', id from public.strategies where slug = 'gold';
insert into public.ledger_entries (user_id, holding_id, type, amount, ym, idempotency_key)
  values ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000a3', 'deposit', 10000, '2026-09-01', 't:d4');
insert into public.payout_methods (id, user_id, type, account_enc, account_hint, account_hash, title, title_verified, ready_at)
  values ('00000000-0000-0000-0000-00000000ee05', '00000000-0000-0000-0000-0000000000b3', 'jazz', 'x', 'x', 'h5', 'Late Close', true, now() - interval '2 days');
do $$ declare w uuid; begin
  w := public.request_withdrawal('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-00000000ee05', 5000, now());
  perform public.approve_withdrawal(w, '00000000-0000-0000-0000-0000000000f2');
  begin perform public.pay_withdrawal(w, '00000000-0000-0000-0000-0000000000f2', 'TX999999'); raise exception 'paid before September closed';
  exception when raise_exception then if sqlerrm = 'paid before September closed' then raise; end if;
    assert sqlerrm like 'Close 2026-09 before paying withdrawals%', sqlerrm; end;
end $$;

-- RLS: own rows only, never the encrypted account; no writes; no money functions
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b3', true);
do $$ declare n int; begin
  select count(*) into n from public.withdrawals; assert n = 1, 'sees ' || n || ' withdrawals';
  select count(*) into n from public.payout_methods; assert n = 1, 'sees ' || n || ' methods';
  begin perform account_enc from public.payout_methods; raise exception 'encrypted account readable';
  exception when insufficient_privilege then null; end;
  begin update public.withdrawals set status = 'paid'; raise exception 'self-paid';
  exception when insufficient_privilege then null; end;
  begin perform public.request_withdrawal('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-00000000ee05', 1000, now()); raise exception 'request callable';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
\echo PHASE 5 WITHDRAWAL TESTS PASSED
