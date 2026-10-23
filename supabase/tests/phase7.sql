-- Phase 7 checks: staff roles on returns/settings/staff, month-close preview, tickets, reconciliation.
\set ON_ERROR_STOP on

create or replace function pg_temp.fails(p_sql text, p_like text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'expected failure: %', p_sql;
exception when raise_exception then
  if sqlerrm like 'expected failure:%' then raise; end if;
  assert sqlerrm like p_like, format('%s -> %s', p_sql, sqlerrm);
end $$;

begin;
insert into auth.users (id, phone, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000f1', null, 'owner@c50.test', '{}'),
  ('00000000-0000-0000-0000-0000000000f2', null, 'comp@c50.test', '{}'),
  ('00000000-0000-0000-0000-0000000000f3', null, 'help@c50.test', '{}'),
  ('00000000-0000-0000-0000-0000000000d1', '923000000701', null, '{"full_name":"Iqra Butt"}');
select public.grant_staff('owner@c50.test', 'owner');
select public.grant_staff('comp@c50.test', 'compliance');
select public.grant_staff('help@c50.test', 'support');

-- returns: compliance can enter month-to-date, only the owner publishes, closed months are locked
do $$ declare cur date := date_trunc('month', now() at time zone 'Asia/Karachi')::date; prev date := (cur - interval '1 month')::date; begin
  perform public.set_strategy_return('00000000-0000-0000-0000-0000000000f2', 'gold', cur, 4.2, 'mtd', 'Broker statement week 3');
  assert (select return_pct from public.strategy_returns r join public.strategies s on s.id = r.strategy_id where s.slug = 'gold' and r.ym = cur) = 4.2, 'mtd saved';
  perform pg_temp.fails(format($q$select public.set_strategy_return('00000000-0000-0000-0000-0000000000f2', 'gold', %L, 5, 'published', 'Final broker statement')$q$, prev), 'Your role can''t do this%');
  perform pg_temp.fails(format($q$select public.set_strategy_return('00000000-0000-0000-0000-0000000000f1', 'gold', %L, 5, 'published', 'Final broker statement')$q$, cur), 'A month can only be published after it ends%');
  perform pg_temp.fails(format($q$select public.set_strategy_return('00000000-0000-0000-0000-0000000000f1', 'gold', %L, 5, 'mtd', 'x')$q$, cur), 'Add a source note%');
  perform pg_temp.fails(format($q$select public.set_strategy_return('00000000-0000-0000-0000-0000000000f3', 'gold', %L, 5, 'mtd', 'Broker statement')$q$, cur), 'Your role can''t do this%');
  -- 2026-09 is closed by the seed-free test DB? close Sep first, then try to change it
  perform public.close_month('2026-09-01');
  perform pg_temp.fails($q$select public.set_strategy_return('00000000-0000-0000-0000-0000000000f1', 'gold', '2026-09-01', 1, 'published', 'Correction attempt')$q$, '% is already closed%');
  assert (select count(*) from public.audit_log where action = 'returns.mtd') = 1, 'returns audited';
end $$;

-- month-close preview: the numbers close_month would book, and why it can't run yet
insert into public.holdings (user_id, strategy_id) select '00000000-0000-0000-0000-0000000000d1', id from public.strategies where slug = 'gold';
insert into public.ledger_entries (user_id, holding_id, type, amount, ym, idempotency_key)
  select '00000000-0000-0000-0000-0000000000d1', h.id, 'deposit', 15000, '2026-10-01', 't7:dep' from public.holdings h where h.user_id = '00000000-0000-0000-0000-0000000000d1';
do $$ declare j jsonb; g jsonb; begin
  j := public.preview_month_close('2026-10-01');
  select x into g from jsonb_array_elements(j->'rows') x where x->>'slug' = 'gold';
  assert (g->>'holdings')::int = 1 and (g->>'value_start')::numeric = 15000, 'preview value ' || g::text;
  assert not (j->>'can_close')::boolean, 'October can''t close yet: ' || j::text;
  j := public.preview_month_close('2026-12-01');
  assert j->>'blocked' like 'Close Oct 2026 first', j::text;
  perform pg_temp.fails($q$select public.staff_close_month('00000000-0000-0000-0000-0000000000f2', '2026-10-01')$q$, 'Your role can''t do this%');
end $$;

-- settings: owner only, range-checked, audited
do $$ begin
  perform public.set_setting('00000000-0000-0000-0000-0000000000f1', 'affiliate_deposit_rate', '0.02');
  assert public.setting_num('affiliate_deposit_rate', 0) = 0.02, 'deposit rate set';
  perform pg_temp.fails($q$select public.set_setting('00000000-0000-0000-0000-0000000000f1', 'affiliate_deposit_rate', '0.5')$q$, 'Deposit commission must be between%');
  perform pg_temp.fails($q$select public.set_setting('00000000-0000-0000-0000-0000000000f1', 'affiliate_fee_share_rate', '"abc"')$q$, 'Enter a number%');
  perform pg_temp.fails($q$select public.set_setting('00000000-0000-0000-0000-0000000000f2', 'affiliate_fee_share_rate', '0.2')$q$, 'Your role can''t do this%');
  perform pg_temp.fails($q$select public.set_setting('00000000-0000-0000-0000-0000000000f1', 'bank_account', '{"bank":"HBL","title":"Capital 50","iban":"PK12"}')$q$, 'Enter the bank, account title and a PK IBAN%');
  perform public.set_setting('00000000-0000-0000-0000-0000000000f1', 'bank_account', '{"bank":"HBL","title":"Capital 50 AI","iban":"pk36 scbl 0000 0011 2345 6702"}');
  assert (select value->>'iban' from public.app_settings where key = 'bank_account') = 'PK36SCBL0000001123456702', 'iban normalised';
  perform pg_temp.fails($q$select public.set_setting('00000000-0000-0000-0000-0000000000f1', 'ledger_purge', '1')$q$, 'Unknown setting%');
  assert (select count(*) from public.audit_log where action = 'settings.set') = 2, 'settings audited';
end $$;

-- staff: owner grants/revokes, nobody changes themselves, revoked staff lose access
do $$ begin
  perform pg_temp.fails($q$select public.staff_grant('00000000-0000-0000-0000-0000000000f2', 'help@c50.test', 'owner')$q$, 'Your role can''t do this%');
  perform pg_temp.fails($q$select public.staff_grant('00000000-0000-0000-0000-0000000000f1', 'owner@c50.test', 'support')$q$, 'You can''t change your own role%');
  perform pg_temp.fails($q$select public.staff_grant('00000000-0000-0000-0000-0000000000f1', 'nobody@c50.test', 'support')$q$, 'No login with email%');
  perform public.staff_grant('00000000-0000-0000-0000-0000000000f1', 'help@c50.test', 'finance');
  assert public.staff_role_of('00000000-0000-0000-0000-0000000000f3') = 'finance', 'role changed';
  perform public.staff_revoke('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f3');
  assert public.staff_role_of('00000000-0000-0000-0000-0000000000f3') is null, 'revoked';
  perform pg_temp.fails($q$select public.staff_revoke('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f1')$q$, 'You can''t remove yourself%');
end $$;

-- tickets: investor opens and replies, staff reply marks it answered, others can't touch it
do $$ declare t jsonb; begin
  t := public.open_ticket('00000000-0000-0000-0000-0000000000d1', 'Deposit', 'Bank transfer not showing', 'I sent Rs 15,000 yesterday.');
  assert t->>'ref' ~ '^T-[0-9A-F]{6}$', 'ticket ref ' || (t->>'ref');
  assert public.ticket_reply((t->>'id')::uuid, '00000000-0000-0000-0000-0000000000f2', true, 'We are checking with the bank.') = 'answered', 'staff reply';
  perform pg_temp.fails(format($q$select public.ticket_reply(%L, '00000000-0000-0000-0000-0000000000f1', false, 'hi')$q$, t->>'id'), 'Ticket not found%');
  assert public.ticket_reply((t->>'id')::uuid, '00000000-0000-0000-0000-0000000000d1', false, 'Thanks') = 'open', 'investor reply reopens';
  assert (select count(*) from public.ticket_messages where ticket_id = (t->>'id')::uuid) = 3, 'messages';
  perform pg_temp.fails($q$select public.open_ticket('00000000-0000-0000-0000-0000000000d1', 'Hacking', 'Subject here', 'Body')$q$, 'Choose a category%');
end $$;

-- reconciliation: clean books pass; a hand-written ledger row without a deposit is caught
do $$ declare j jsonb; begin
  j := public.run_reconciliation('test');
  assert (j->>'ok')::boolean, 'clean books: ' || j::text;
  insert into public.ledger_entries (user_id, holding_id, type, amount, ym, ref_type, ref_id, idempotency_key)
    select '00000000-0000-0000-0000-0000000000d1', h.id, 'deposit', 999, '2026-10-01', 'deposit', gen_random_uuid()::text, 't7:ghost'
      from public.holdings h where h.user_id = '00000000-0000-0000-0000-0000000000d1';
  j := public.run_reconciliation('test');
  assert not (j->>'ok')::boolean, 'ghost deposit not caught';
  assert (select (x->>'ok')::boolean from jsonb_array_elements(j->'checks') x where x->>'name' = 'Deposits match the ledger') = false, 'which check';
  assert (public.admin_overview()->'reconcile'->>'ok')::boolean = false, 'overview shows last run';
  assert (public.admin_overview()->>'investors')::int = 1, 'investors exclude staff';
end $$;

-- RLS: investors see their own tickets only, never nominees or reconciliation
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f1', true);
do $$ begin
  assert (select count(*) from public.tickets) = 0, 'sees others'' tickets';
  begin perform 1 from public.reconciliation_runs; raise exception 'recon readable';
  exception when insufficient_privilege then null; end;
  begin perform public.admin_overview(); raise exception 'overview callable';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
\echo PHASE 7 ADMIN TESTS PASSED
