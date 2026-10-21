-- Phase 1 checks. Run after the migrations; any failure raises and stops the script.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, phone, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', '923001234567', '{"full_name":"Ali Raza","email":"Ali@Example.com"}'),
  ('00000000-0000-0000-0000-00000000000b', '923331112222', '{"full_name":"Sara Khan"}');
-- B signs up again with A's code, C uses a junk code.
update auth.users set raw_user_meta_data = raw_user_meta_data where false;
do $$ declare a_code text; begin
  select referral_code into a_code from public.profiles where phone = '+923001234567';
  insert into auth.users (id, phone, raw_user_meta_data) values
    ('00000000-0000-0000-0000-00000000000c', '923451234567', jsonb_build_object('full_name','Umar Farooq','ref', lower(a_code))),
    ('00000000-0000-0000-0000-00000000000d', '923461234567', '{"full_name":"Zed","ref":"NOPE99"}');
end $$;

do $$ declare n int; r record; begin
  select count(*) into n from public.strategies; assert n = 6, 'expected 6 strategies, got ' || n;
  select count(*) into n from public.strategy_returns where status = 'published'; assert n = 132, 'published rows ' || n;
  select count(*) into n from public.strategy_returns where status = 'mtd'; assert n = 6, 'mtd rows ' || n;
  select return_pct into r from public.strategy_returns sr join public.strategies s on s.id = sr.strategy_id
   where s.slug = 'gold' and ym = '2025-06-01'; assert r.return_pct = -10, 'gold 2025-06';

  select * into r from public.profiles where phone = '+923001234567';
  assert r.full_name = 'Ali Raza' and r.email = 'ali@example.com', 'profile A fields';
  assert r.referral_code ~ '^ALIRAZ[0-9]{2}$', 'code A ' || r.referral_code;
  select * into r from public.profiles where phone = '+923451234567';
  assert r.referred_by = (select id from public.profiles where phone = '+923001234567'), 'C referred by A';
  select * into r from public.profiles where phone = '+923461234567';
  assert r.referred_by is null and r.referral_code ~ '^ZED[0-9]{2}$', 'junk ref ignored; short name code';
  select count(*) into n from public.audit_log where action = 'profile.create'; assert n = 4, 'audit rows ' || n;
end $$;

-- audit_log is append-only, even for the table owner
do $$ begin
  begin update public.audit_log set reason = 'x'; raise exception 'update allowed';
  exception when raise_exception then if sqlerrm = 'update allowed' then raise; end if; end;
  begin delete from public.audit_log; raise exception 'delete allowed';
  exception when raise_exception then if sqlerrm = 'delete allowed' then raise; end if; end;
end $$;

-- RLS as user A
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
do $$ declare n int; begin
  select count(*) into n from public.profiles; assert n = 1, 'A sees ' || n || ' profiles';
  select count(*) into n from public.profiles where phone = '+923331112222'; assert n = 0, 'A sees B';
  select count(*) into n from public.strategy_returns; assert n = 138, 'A sees returns ' || n;
  begin select count(*) into n from public.audit_log; raise exception 'audit readable';
  exception when insufficient_privilege then null; end;
  begin update public.profiles set full_name = 'x'; raise exception 'profile writable';
  exception when insufficient_privilege then null; end;
  begin insert into public.strategy_returns (strategy_id, ym, return_pct, source_note, status)
        select id, '2030-01-01', 99, 'x', 'published' from public.strategies limit 1;
        raise exception 'returns writable';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- anon: public returns only, no drafts, no profiles
insert into public.strategy_returns (strategy_id, ym, return_pct, source_note, status)
  select id, '2030-01-01', 1, 'draft test', 'draft' from public.strategies where slug = 'gold';
set local role anon;
do $$ declare n int; begin
  select count(*) into n from public.strategy_returns; assert n = 138, 'anon sees ' || n || ' (draft leaked?)';
  select count(*) into n from public.profiles; assert n = 0, 'anon sees profiles';
end $$;
reset role;
rollback;
\echo ALL PHASE 1 DB TESTS PASSED

-- rate limit: 5 allowed, 6th refused; anon can't call it
begin;
do $$ declare i int; ok boolean; begin
  for i in 1..5 loop
    select public.consume_rate_limit('t:login', 5, 900) into ok; assert ok, 'hit ' || i || ' refused';
  end loop;
  select public.consume_rate_limit('t:login', 5, 900) into ok; assert not ok, '6th hit allowed';
  update public.rate_limits set window_start = now() - interval '16 minutes' where key = 't:login';
  select public.consume_rate_limit('t:login', 5, 900) into ok; assert ok, 'window did not reset';
end $$;
set local role anon;
do $$ begin
  perform public.consume_rate_limit('x', 1, 1); raise exception 'anon could call rate limit';
exception when insufficient_privilege then null; end $$;
reset role;
rollback;
\echo RATE LIMIT TESTS PASSED
