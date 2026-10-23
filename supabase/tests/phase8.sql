-- Phase 7 hardening checks: notifications come from real events, once each; RLS on them.
\set ON_ERROR_STOP on
begin;
insert into auth.users (id, phone, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000f1', null, 'owner@c50.test', '{}'),
  ('00000000-0000-0000-0000-0000000000e1', '923000000801', null, '{"full_name":"Zara Ali"}');
select public.grant_staff('owner@c50.test', 'owner');
update public.profiles set referral_code = 'ZARA01' where user_id = '00000000-0000-0000-0000-0000000000e1';
insert into public.affiliate_codes values ('ZARA01', '00000000-0000-0000-0000-0000000000e1');
insert into auth.users (id, phone, raw_user_meta_data) values ('00000000-0000-0000-0000-0000000000e2', '923000000802', '{"full_name":"omar farooq","ref":"ZARA01"}');
insert into public.deposits (id, user_id, strategy_id, amount, method, reference) select '00000000-0000-0000-0000-00000000de81', '00000000-0000-0000-0000-0000000000e2', id, 15000, 'bank', 'C50-E81' from public.strategies where slug = 'gold';
insert into public.deposits (id, user_id, strategy_id, amount, method, reference) select '00000000-0000-0000-0000-00000000de82', '00000000-0000-0000-0000-0000000000e2', id, 7500.5, 'jazzcash', 'C50-E82' from public.strategies where slug = 'gold';
do $$ declare t text; begin
  assert (select title || ' / ' || body from public.notifications where user_id = '00000000-0000-0000-0000-0000000000e1') = 'New member joined with your link / Omar · not invested yet', 'member note';
  perform public.credit_deposit('00000000-0000-0000-0000-00000000de81', null, 'test', 'E81');
  perform public.credit_deposit('00000000-0000-0000-0000-00000000de81', null, 'test', 'E81');   -- replay
  select body into t from public.notifications where user_id = '00000000-0000-0000-0000-0000000000e2' and kind = 'deposit';
  assert t like 'Rs 15,000 added. It starts earning in %', t;
  assert (select count(*) from public.notifications where kind = 'deposit') = 1, 'deposit notified once';
  perform public.close_deposit('00000000-0000-0000-0000-00000000de82', 'failed', null, 'declined');
  assert (select body from public.notifications where dedupe_key like 'dep:%:failed') = 'Rs 7,500.50 (C50-E82): nothing was charged to your balance.', 'failed note';
end $$;
-- month close notes each holder with their own result
insert into public.holdings (user_id, strategy_id) select '00000000-0000-0000-0000-0000000000e1', id from public.strategies where slug = 'gold';
insert into public.ledger_entries (user_id, holding_id, type, amount, ym, idempotency_key)
  select '00000000-0000-0000-0000-0000000000e1', h.id, 'deposit', 15000, '2026-09-01', 't8:dep' from public.holdings h where h.user_id = '00000000-0000-0000-0000-0000000000e1';
do $$ begin
  perform public.close_month('2026-09-01');
  assert (select body from public.notifications where dedupe_key = 'month:2026-09:00000000-0000-0000-0000-0000000000e1')
    = 'Profit Rs 5,850 added to your balance (after the 2.5% fee Rs 150).', (select body from public.notifications where kind = 'month');
  assert (select count(*) from public.notifications where kind = 'month') = 1, 'only holders';
end $$;
-- tickets: a staff reply notifies the investor, their own message doesn't
do $$ declare t jsonb; begin
  t := public.open_ticket('00000000-0000-0000-0000-0000000000e2', 'Other', 'Question here', 'Hello');
  perform public.ticket_reply((t->>'id')::uuid, '00000000-0000-0000-0000-0000000000f1', true, 'Hi');
  assert (select count(*) from public.notifications where kind = 'support') = 1, 'support note';
end $$;
-- RLS: own notifications only; mark read touches only your own
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e2', true);
do $$ begin
  assert (select count(*) from public.notifications) = 3, 'own notes ' || (select count(*) from public.notifications);
  perform public.mark_notifications_read();
  begin perform public.notify('00000000-0000-0000-0000-0000000000e2', 'x', 'x', 'fake', '', '#', null); raise exception 'notify callable';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.trusted_devices; raise exception 'devices readable';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.notifications where read_at is null) = 2, 'only own marked read';
end $$;
rollback;
begin;
insert into auth.users (id, phone, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000f1', null, 'owner@c50.test', '{}'), ('00000000-0000-0000-0000-0000000000f2', null, 'comp@c50.test', '{}');
select public.grant_staff('owner@c50.test', 'owner');
select public.grant_staff('comp@c50.test', 'compliance');
do $$ begin
  perform public.set_policy('00000000-0000-0000-0000-0000000000f1', 'privacy', 'Draft with [COMPANY ADDRESS] still to fill in, long enough to publish later on.', false);
  assert (select value->'privacy'->>'published' from public.app_settings where key = 'policies') = 'false', 'saved as draft';
  begin perform public.set_policy('00000000-0000-0000-0000-0000000000f1', 'privacy', 'Draft with [COMPANY ADDRESS] still to fill in, long enough to publish later on.', true); raise exception 'published placeholder';
  exception when raise_exception then assert sqlerrm like 'Fill in every%', sqlerrm; end;
  begin perform public.set_policy('00000000-0000-0000-0000-0000000000f2', 'privacy', 'x', false); raise exception 'compliance edited';
  exception when raise_exception then assert sqlerrm like 'Your role%', sqlerrm; end;
  perform public.set_policy('00000000-0000-0000-0000-0000000000f1', 'privacy', 'We keep identity records for five years after an account closes, as the law requires.', true);
  assert (select value->'privacy'->>'published' from public.app_settings where key = 'policies') = 'true', 'published';
  assert (select count(*) from public.audit_log where action like 'policy.%') = 2, 'policy audited';
end $$;
rollback;
\echo PHASE 8 HARDENING TESTS PASSED
