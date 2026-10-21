-- Phase 4 checks: credit once, effective month, failures, two-person bank confirmation, RLS.
\set ON_ERROR_STOP on
begin;
insert into auth.users (id, phone, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000d1', '923000000301', null, '{"full_name":"Payer One"}'),
  ('00000000-0000-0000-0000-0000000000d2', '923000000302', null, '{"full_name":"Payer Two"}'),
  ('00000000-0000-0000-0000-0000000000f1', null, 'owner@c50.test', '{}'),
  ('00000000-0000-0000-0000-0000000000f2', null, 'finance@c50.test', '{}'),
  ('00000000-0000-0000-0000-0000000000f3', null, 'support@c50.test', '{}');
select public.grant_staff('owner@c50.test', 'owner'), public.grant_staff('finance@c50.test', 'finance'),
       public.grant_staff('support@c50.test', 'support');
insert into public.deposits (id, user_id, strategy_id, amount, method, reference) select
  '00000000-0000-0000-0000-00000000de01', '00000000-0000-0000-0000-0000000000d1', id, 15000, 'jazzcash', 'C50TEST0001'
  from public.strategies where slug = 'gold';
insert into public.deposits (id, user_id, strategy_id, amount, method, reference) select
  '00000000-0000-0000-0000-00000000de02', '00000000-0000-0000-0000-0000000000d1', id, 20000, 'bank', 'C50-BANK01'
  from public.strategies where slug = 'kitchen';
insert into public.deposits (id, user_id, strategy_id, amount, method, reference) select
  '00000000-0000-0000-0000-00000000de03', '00000000-0000-0000-0000-0000000000d2', id, 8000, 'usdt', 'C50TEST0003'
  from public.strategies where slug = 'crypto';

do $$ declare r jsonb; n int; v numeric; begin
  -- below minimum is refused by the table itself
  begin insert into public.deposits (user_id, strategy_id, amount, method, reference)
        select '00000000-0000-0000-0000-0000000000d1', id, 4999, 'bank', 'X' from public.strategies limit 1;
        raise exception 'under minimum accepted';
  exception when check_violation then null; end;

  -- provider credit: once, next month, holding created
  r := public.credit_deposit('00000000-0000-0000-0000-00000000de01', null, 'jazzcash_ipn', 'JC-TXN-1');
  assert r->>'effective_ym' = to_char(public.deposit_effective_ym(now()), 'YYYY-MM'), 'effective month ' || r;
  assert public.deposit_effective_ym('2026-10-31 23:30:00+05') = '2026-11-01', 'Oct 31 11:30pm PKT -> Nov';
  assert public.deposit_effective_ym('2026-10-31 19:30:00+00') = '2026-12-01', 'Nov 1 12:30am PKT -> Dec';
  r := public.credit_deposit('00000000-0000-0000-0000-00000000de01', null, 'jazzcash_ipn', 'JC-TXN-1');
  assert (r->>'already')::boolean, 'replay not detected';
  select count(*), sum(amount) into n, v from public.ledger_entries where ref_id = '00000000-0000-0000-0000-00000000de01';
  assert n = 1 and v = 15000, 'ledger after replay: ' || n || ' rows, ' || v;
  select count(*) into n from public.holdings where user_id = '00000000-0000-0000-0000-0000000000d1'; assert n = 1, 'holding';

  -- one provider transaction can't pay for two deposits
  insert into public.deposits (id, user_id, strategy_id, amount, method, reference) select
    '00000000-0000-0000-0000-00000000de05', '00000000-0000-0000-0000-0000000000d1', id, 15000, 'jazzcash', 'C50TEST0005'
    from public.strategies where slug = 'gold';
  begin perform public.credit_deposit('00000000-0000-0000-0000-00000000de05', null, 'jazzcash_ipn', 'JC-TXN-1');
        raise exception 'provider payment reused';
  exception when raise_exception then if sqlerrm = 'provider payment reused' then raise; end if;
    assert sqlerrm like 'Payment JC-TXN-1 was already used for deposit C50TEST0001%', sqlerrm; end;

  -- failed deposit can't be credited later; paid can't be failed
  perform public.close_deposit('00000000-0000-0000-0000-00000000de03', 'failed', null, 'provider said failed');
  begin perform public.credit_deposit('00000000-0000-0000-0000-00000000de03', null, 'x', null); raise exception 'credited a failed deposit';
  exception when raise_exception then if sqlerrm = 'credited a failed deposit' then raise; end if; end;
  assert public.close_deposit('00000000-0000-0000-0000-00000000de01', 'failed', null, 'late failure') = 'paid', 'paid deposit was failed';

  -- bank: support can't confirm; same person can't confirm twice; references must match
  begin perform public.confirm_bank_deposit('00000000-0000-0000-0000-00000000de02', '00000000-0000-0000-0000-0000000000f3', 'FT12345');
        raise exception 'support confirmed';
  exception when raise_exception then if sqlerrm = 'support confirmed' then raise; end if; end;
  r := public.confirm_bank_deposit('00000000-0000-0000-0000-00000000de02', '00000000-0000-0000-0000-0000000000f1', 'ft 12345');
  assert (r->>'confirmations')::int = 1, 'first confirm ' || r;
  begin perform public.confirm_bank_deposit('00000000-0000-0000-0000-00000000de02', '00000000-0000-0000-0000-0000000000f1', 'FT12345');
        raise exception 'same staff confirmed twice';
  exception when raise_exception then if sqlerrm = 'same staff confirmed twice' then raise; end if;
    assert sqlerrm like 'A second, different staff member%', sqlerrm; end;
  begin perform public.confirm_bank_deposit('00000000-0000-0000-0000-00000000de02', '00000000-0000-0000-0000-0000000000f2', 'FT99999');
        raise exception 'mismatched reference accepted';
  exception when raise_exception then if sqlerrm = 'mismatched reference accepted' then raise; end if; end;
  select count(*) into n from public.ledger_entries where ref_id = '00000000-0000-0000-0000-00000000de02'; assert n = 0, 'credited after one confirm';
  r := public.confirm_bank_deposit('00000000-0000-0000-0000-00000000de02', '00000000-0000-0000-0000-0000000000f2', 'FT12345');
  assert r->>'status' = 'paid', 'second confirm ' || r;
  select count(*) into n from public.ledger_entries where ref_id = '00000000-0000-0000-0000-00000000de02'; assert n = 1, 'bank ledger';
  select count(*) into n from public.audit_log where action like 'deposit.%'; assert n = 5, 'deposit audit rows ' || n;
  -- the same bank transaction can't pay for a second deposit
  insert into public.deposits (id, user_id, strategy_id, amount, method, reference) select
    '00000000-0000-0000-0000-00000000de04', '00000000-0000-0000-0000-0000000000d2', id, 20000, 'bank', 'C50-BANK02'
    from public.strategies where slug = 'gold';
  begin perform public.confirm_bank_deposit('00000000-0000-0000-0000-00000000de04', '00000000-0000-0000-0000-0000000000f1', 'FT12345');
        raise exception 'bank reference reused';
  exception when raise_exception then if sqlerrm = 'bank reference reused' then raise; end if;
    assert sqlerrm like 'Bank reference FT12345 was already used for deposit C50-BANK01%', sqlerrm; end;

  -- payment_events are append-only
  insert into public.payment_events (provider, signature_ok, outcome, payload) values ('test', true, 'x', '{}');
  begin update public.payment_events set outcome = 'y'; raise exception 'event edited';
  exception when raise_exception then if sqlerrm = 'event edited' then raise; end if; end;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d2', true);
do $$ declare n int; begin
  select count(*) into n from public.deposits; assert n = 2, 'sees ' || n || ' deposits';
  begin update public.deposits set status = 'paid'; raise exception 'self-credit';
  exception when insufficient_privilege then null; end;
  begin perform public.credit_deposit('00000000-0000-0000-0000-00000000de03', null, 'x', null); raise exception 'credit callable';
  exception when insufficient_privilege then null; end;
  begin select count(*) into n from public.payment_events; raise exception 'events readable';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
\echo PHASE 4 DEPOSIT TESTS PASSED
