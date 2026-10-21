-- Phase 2 checks: month close (brief §11 tests 1 and 2), idempotency, guards, append-only, RLS.
\set ON_ERROR_STOP on

create or replace function pg_temp.bal(p_phone text, p_slug text) returns numeric language sql as $$
  select coalesce(sum(l.amount), 0) from public.ledger_entries l
    join public.holdings h on h.id = l.holding_id join public.strategies s on s.id = h.strategy_id
    join auth.users u on u.id = h.user_id where u.phone = p_phone and s.slug = p_slug $$;

create or replace function pg_temp.deposit(p_phone text, p_slug text, p_amt numeric, p_ym date) returns void language plpgsql as $$
declare v_uid uuid; v_h uuid; begin
  select id into v_uid from auth.users where phone = p_phone;
  insert into public.holdings (user_id, strategy_id) select v_uid, id from public.strategies where slug = p_slug
    on conflict (user_id, strategy_id) do nothing;
  select h.id into v_h from public.holdings h join public.strategies s on s.id = h.strategy_id where h.user_id = v_uid and s.slug = p_slug;
  insert into public.ledger_entries (user_id, holding_id, type, amount, ym, idempotency_key)
  values (v_uid, v_h, 'deposit', p_amt, p_ym, 'test:' || gen_random_uuid());
end $$;

-- Test 1: gold +40% (Sep 2026) on 15,000 -> profit 6,000, fee 150, value 20,850; re-run changes nothing
begin;
insert into auth.users (id, phone, raw_user_meta_data) values (gen_random_uuid(), '923000000101', '{"full_name":"Test One"}');
select pg_temp.deposit('923000000101', 'gold', 15000, '2026-09-01');
do $$ declare r jsonb; n int; begin
  r := public.close_month('2026-09-01');
  assert (r->>'total_profit')::numeric = 6000 and (r->>'total_fees')::numeric = 150, 'close result ' || r;
  assert pg_temp.bal('923000000101', 'gold') = 20850, 'value_end ' || pg_temp.bal('923000000101', 'gold');
  select count(*) into n from public.ledger_entries; assert n = 3, 'entries ' || n;
  r := public.close_month('2026-09-01');
  assert (r->>'already_closed')::boolean, 'second close not a no-op';
  select count(*) into n from public.ledger_entries; assert n = 3, 'entries after re-run ' || n;
  assert pg_temp.bal('923000000101', 'gold') = 20850, 'value changed on re-run';
  select count(*) into n from public.audit_log where action = 'month.close'; assert n = 1, 'audit ' || n;
end $$;
rollback;

-- Test 2: gold -10% (Jun 2025) on 10,000 -> loss 1,000, fee 0
begin;
insert into auth.users (id, phone, raw_user_meta_data) values (gen_random_uuid(), '923000000102', '{"full_name":"Test Two"}');
select pg_temp.deposit('923000000102', 'gold', 10000, '2025-06-01');
do $$ declare n int; begin
  perform public.close_month('2025-06-01');
  assert pg_temp.bal('923000000102', 'gold') = 9000, 'value ' || pg_temp.bal('923000000102', 'gold');
  select count(*) into n from public.ledger_entries where type = 'loss' and amount = -1000; assert n = 1, 'loss entry';
  select count(*) into n from public.ledger_entries where type = 'fee'; assert n = 0, 'fee charged on a loss';
end $$;
rollback;

-- Guards: gaps, earlier months, unpublished returns, closed-month deposits, append-only
begin;
insert into auth.users (id, phone, raw_user_meta_data) values (gen_random_uuid(), '923000000103', '{"full_name":"Test Three"}');
select pg_temp.deposit('923000000103', 'crypto', 5000, '2026-07-01');
do $$ declare ok boolean; begin
  perform public.close_month('2026-07-01');
  begin perform public.close_month('2026-09-01'); raise exception 'gap allowed';
  exception when raise_exception then if sqlerrm = 'gap allowed' then raise; end if;
    assert sqlerrm like 'Close 2026-08 first%', sqlerrm; end;
  begin perform public.close_month('2026-06-01'); raise exception 'earlier month allowed';
  exception when raise_exception then if sqlerrm = 'earlier month allowed' then raise; end if; end;
  begin perform pg_temp.deposit('923000000103', 'crypto', 5000, '2026-07-01'); raise exception 'deposit into closed month';
  exception when raise_exception then if sqlerrm = 'deposit into closed month' then raise; end if;
    assert sqlerrm like 'Month 2026-07 is already closed%', sqlerrm; end;
  begin update public.ledger_entries set amount = 1; raise exception 'ledger update allowed';
  exception when raise_exception then if sqlerrm = 'ledger update allowed' then raise; end if; end;
  begin delete from public.ledger_entries; raise exception 'ledger delete allowed';
  exception when raise_exception then if sqlerrm = 'ledger delete allowed' then raise; end if; end;
  begin insert into public.ledger_entries (user_id, holding_id, type, amount, ym, idempotency_key)
        select user_id, holding_id, 'fee', 5, '2026-08-01', 'bad-sign' from public.ledger_entries limit 1;
        raise exception 'positive fee allowed';
  exception when check_violation then null; end;
end $$;
-- the current month can't be closed before it ends; an mtd-only month can't be closed at all
do $$ declare cur date := date_trunc('month', now() at time zone 'Asia/Karachi')::date; begin
  perform public.close_month('2026-08-01'); perform public.close_month('2026-09-01');
  begin perform public.close_month(cur); raise exception 'closed the current month';
  exception when raise_exception then if sqlerrm = 'closed the current month' then raise; end if;
    assert sqlerrm like '%has not ended yet%' or sqlerrm like 'Close % first%', sqlerrm; end;
end $$;
rollback;
begin;
insert into auth.users (id, phone, raw_user_meta_data) values (gen_random_uuid(), '923000000107', '{"full_name":"Test Seven"}');
select pg_temp.deposit('923000000107', 'crypto', 5000, '2026-10-01');
update public.strategy_returns set status = 'mtd' where ym = '2026-09-01' and strategy_id = (select id from public.strategies where slug = 'crypto');
select pg_temp.deposit('923000000107', 'crypto', 5000, '2026-09-01');
do $$ begin
  begin perform public.close_month('2026-09-01'); raise exception 'closed on an mtd figure';
  exception when raise_exception then if sqlerrm = 'closed on an mtd figure' then raise; end if;
    assert sqlerrm like 'No published crypto return for 2026-09%', sqlerrm; end;
end $$;
rollback;

-- RLS: own ledger only, no writes, no close_month
begin;
insert into auth.users (id, phone, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000e1', '923000000104', '{"full_name":"Test Four"}'),
  ('00000000-0000-0000-0000-0000000000e2', '923000000105', '{"full_name":"Test Five"}');
select pg_temp.deposit('923000000104', 'gold', 7000, '2026-09-01');
select pg_temp.deposit('923000000105', 'gold', 9000, '2026-09-01');
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', true);
do $$ declare n int; begin
  select count(*) into n from public.ledger_entries; assert n = 1, 'sees ' || n || ' ledger rows';
  select count(*) into n from public.holdings; assert n = 1, 'sees ' || n || ' holdings';
  begin insert into public.ledger_entries (user_id, type, amount, ym, idempotency_key)
        values ('00000000-0000-0000-0000-0000000000e1', 'adjustment', 1000000, '2026-10-01', 'steal');
        raise exception 'ledger insert allowed';
  exception when insufficient_privilege then null; end;
  begin perform public.close_month('2026-09-01'); raise exception 'close_month callable';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;

-- Demo purge removes the demo account and its money, nothing else
begin;
insert into auth.users (id, phone, raw_user_meta_data) values
  (gen_random_uuid(), '923001234567', '{"full_name":"Demo Investor"}'),
  (gen_random_uuid(), '923000000106', '{"full_name":"Real Person"}');
select pg_temp.deposit('923001234567', 'gold', 5000, '2026-09-01');
select pg_temp.deposit('923000000106', 'gold', 5000, '2026-09-01');
do $$ declare n int; begin
  perform public.close_month('2026-09-01');
  perform public.purge_demo_data();
  select count(*) into n from auth.users where phone = '923001234567'; assert n = 0, 'demo user left';
  select count(*) into n from public.ledger_entries; assert n = 3, 'other ledger rows touched: ' || n;
  begin delete from public.ledger_entries; raise exception 'purge flag leaked';
  exception when raise_exception then if sqlerrm = 'purge flag leaked' then raise; end if; end;
end $$;
rollback;

\echo PHASE 2 LEDGER TESTS PASSED
