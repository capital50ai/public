-- Capital 50 AI — Phase 7: staff admin panel (PRODUCTION-BRIEF §6, §7). Safe to re-run.
-- Every staff action goes through a function here that checks the role and writes the audit log.

-- The role of an active staff member, or null.
create or replace function public.staff_role_of(p_staff uuid) returns staff_role
language sql stable security definer set search_path = public as $$
  select role from staff_members where user_id = p_staff and active
$$;

create or replace function public.require_staff(p_staff uuid, p_roles staff_role[]) returns staff_role
language plpgsql stable security definer set search_path = public as $$
declare v staff_role := staff_role_of(p_staff);
begin
  if v is null or not (v = any (p_roles)) then
    raise exception 'Your role can''t do this (needs %)', array_to_string(p_roles, ' or ');
  end if;
  return v;
end $$;

-- ------------------------------------------------------------------ returns
-- Owner/compliance enter a month's figure as a draft or month-to-date estimate; only the owner
-- publishes. A closed month can never change: its money has already been booked.
create or replace function public.set_strategy_return(p_staff uuid, p_slug text, p_ym date, p_pct numeric, p_status return_status, p_note text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_role staff_role := require_staff(p_staff, case when p_status = 'published' then array['owner']::staff_role[]
                                                    else array['owner', 'compliance']::staff_role[] end);
  v_sid  uuid;
  v_old  strategy_returns%rowtype;
  v_last date := (select max(ym) from month_closes);
begin
  if p_ym is null or extract(day from p_ym) <> 1 then raise exception 'Pick a month'; end if;
  if p_pct is null or p_pct < -100 or p_pct > 1000 then raise exception 'Enter a return between -100%% and 1000%%'; end if;
  if length(trim(coalesce(p_note, ''))) < 5 then raise exception 'Add a source note (where this figure comes from)'; end if;
  if v_last is not null and p_ym <= v_last then
    raise exception '% is already closed; its return can''t change', to_char(p_ym, 'Mon YYYY');
  end if;
  if p_ym > date_trunc('month', now() at time zone 'Asia/Karachi')::date then raise exception 'That month hasn''t started'; end if;
  if p_status = 'published' and p_ym >= date_trunc('month', now() at time zone 'Asia/Karachi')::date then
    raise exception 'A month can only be published after it ends; use month-to-date until then';
  end if;
  select id into v_sid from strategies where slug = p_slug;
  if v_sid is null then raise exception 'Unknown strategy'; end if;

  select * into v_old from strategy_returns where strategy_id = v_sid and ym = p_ym for update;
  insert into strategy_returns (strategy_id, ym, return_pct, status, source_note, published_at, published_by)
  values (v_sid, p_ym, round(p_pct, 3), p_status, trim(p_note),
          case when p_status = 'published' then now() end, case when p_status = 'published' then p_staff end)
  on conflict (strategy_id, ym) do update
     set return_pct = excluded.return_pct, status = excluded.status, source_note = excluded.source_note,
         published_at = excluded.published_at, published_by = excluded.published_by;

  insert into audit_log (actor_id, actor_role, action, entity, entity_id, before, after, reason)
  values (p_staff, v_role::text, 'returns.' || p_status, 'strategy_returns', p_slug || ':' || to_char(p_ym, 'YYYY-MM'),
          case when v_old.id is not null then jsonb_build_object('pct', v_old.return_pct, 'status', v_old.status) end,
          jsonb_build_object('pct', round(p_pct, 3), 'status', p_status), trim(p_note));
  return p_status::text;
end $$;

-- What close_month(p_ym) would book, without booking anything.
create or replace function public.preview_month_close(p_ym date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_last  date := (select max(ym) from month_closes);
  v_rows  jsonb;
  v_block text;
begin
  with hv as (
    select h.strategy_id, h.id,
           (select coalesce(sum(amount), 0) from ledger_entries l
             where l.holding_id = h.id and (l.ym < p_ym or (l.ym = p_ym and l.type in ('deposit', 'withdrawal')))) as v
      from holdings h
  ), s as (
    select st.slug, st.name, st.sort_order, count(hv.id) filter (where hv.v > 0) as holdings,
           coalesce(sum(hv.v) filter (where hv.v > 0), 0) as value_start,
           r.return_pct, r.status,
           coalesce(sum(round(hv.v * r.return_pct / 100, 2)) filter (where hv.v > 0), 0) as profit,
           coalesce(sum(round(greatest(round(hv.v * r.return_pct / 100, 2), 0) * 0.025, 2)) filter (where hv.v > 0), 0) as fees
      from strategies st
      left join hv on hv.strategy_id = st.id
      left join strategy_returns r on r.strategy_id = st.id and r.ym = p_ym
     group by st.slug, st.name, st.sort_order, r.return_pct, r.status
  )
  select jsonb_agg(jsonb_build_object('slug', slug, 'name', name, 'holdings', holdings, 'value_start', value_start,
                                      'r', return_pct, 'status', status,
                                      'profit', case when return_pct is null then null else profit end,
                                      'fees', case when return_pct is null then null else fees end) order by sort_order)
    into v_rows from s;

  v_block := case
    when exists (select 1 from month_closes where ym = p_ym) then 'Already closed'
    when v_last is not null and p_ym <> (v_last + interval '1 month')::date then 'Close ' || to_char(v_last + interval '1 month', 'Mon YYYY') || ' first'
    when p_ym >= date_trunc('month', now() at time zone 'Asia/Karachi')::date then 'The month has not ended yet'
    when exists (select 1 from jsonb_array_elements(v_rows) x where (x->>'holdings')::int > 0 and coalesce(x->>'status', '') <> 'published')
      then 'Publish every strategy that has investors first'
  end;
  return jsonb_build_object('ym', to_char(p_ym, 'YYYY-MM'), 'rows', v_rows, 'can_close', v_block is null, 'blocked', v_block);
end $$;

-- Staff wrapper so the close is attributed and owner-only.
create or replace function public.staff_close_month(p_staff uuid, p_ym date) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform require_staff(p_staff, array['owner']::staff_role[]);
  return close_month(p_ym, p_staff);
end $$;

-- ------------------------------------------------------------------ tickets
do $$ begin
  create type public.ticket_status as enum ('open', 'answered', 'closed');
exception when duplicate_object then null; end $$;

create table if not exists public.tickets (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete restrict,
  ref             text not null unique,
  category        text not null check (category in ('Deposit', 'Withdrawal', 'Verification (KYC)', 'Affiliate', 'Account', 'Account closure', 'Other')),
  subject         text not null check (length(subject) between 3 and 80),
  status          public.ticket_status not null default 'open',
  assigned_to     uuid references auth.users(id),
  last_message_at timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists tickets_user on public.tickets (user_id, created_at desc);
create index if not exists tickets_queue on public.tickets (status, last_message_at);
drop trigger if exists tickets_updated on public.tickets;
create trigger tickets_updated before update on public.tickets for each row execute function public.set_updated_at();

create table if not exists public.ticket_messages (
  id         uuid primary key default gen_random_uuid(),
  ticket_id  uuid not null references public.tickets(id) on delete cascade,
  author_id  uuid not null references auth.users(id),
  from_staff boolean not null,
  body       text not null check (length(body) between 1 and 1500),
  created_at timestamptz not null default now()
);
create index if not exists ticket_messages_ticket on public.ticket_messages (ticket_id, created_at);
-- Append-only, like the ledger: only the owner's demo/test purge (transaction-local flag) can delete.
create or replace function public.append_only_unless_purge() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' and current_setting('c50.ledger_purge', true) = 'on' then return old; end if;
  raise exception '% is append-only', tg_table_name;
end $$;

drop trigger if exists ticket_messages_no_change on public.ticket_messages;
create trigger ticket_messages_no_change before update or delete on public.ticket_messages
  for each row execute function public.append_only_unless_purge();
drop trigger if exists payment_events_no_change on public.payment_events;
create trigger payment_events_no_change before update or delete on public.payment_events
  for each row execute function public.append_only_unless_purge();

create or replace function public.open_ticket(p_user uuid, p_category text, p_subject text, p_body text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_ref text;
begin
  if p_category is null or p_category not in ('Deposit', 'Withdrawal', 'Verification (KYC)', 'Affiliate', 'Account', 'Account closure', 'Other') then
    raise exception 'Choose a category';
  end if;
  if length(trim(coalesce(p_subject, ''))) not between 3 and 80 then raise exception 'Write a subject (3 to 80 characters)'; end if;
  if length(trim(coalesce(p_body, ''))) not between 1 and 1500 then raise exception 'Write your message (up to 1,500 characters)'; end if;
  if (select count(*) from tickets where user_id = p_user and status <> 'closed') >= 5 then
    raise exception 'You have 5 open tickets. Please wait for a reply or close one first.';
  end if;
  loop
    v_ref := 'T-' || upper(substr(md5(gen_random_uuid()::text), 1, 6));
    exit when not exists (select 1 from tickets where ref = v_ref);
  end loop;
  insert into tickets (user_id, ref, category, subject) values (p_user, v_ref, p_category, trim(p_subject)) returning id into v_id;
  insert into ticket_messages (ticket_id, author_id, from_staff, body) values (v_id, p_user, false, trim(p_body));
  insert into audit_log (actor_id, actor_role, action, entity, entity_id, after)
  values (p_user, 'investor', 'ticket.open', 'tickets', v_id::text, jsonb_build_object('ref', v_ref, 'category', p_category));
  return jsonb_build_object('id', v_id, 'ref', v_ref);
end $$;

-- A reply from the investor (p_staff false) or from staff. Staff replies mark it answered.
create or replace function public.ticket_reply(p_ticket uuid, p_author uuid, p_staff boolean, p_body text) returns text
language plpgsql security definer set search_path = public as $$
declare t tickets%rowtype; v_role staff_role;
begin
  select * into t from tickets where id = p_ticket for update;
  if not found then raise exception 'Ticket not found'; end if;
  if p_staff then
    v_role := require_staff(p_author, array['owner', 'compliance', 'finance', 'support']::staff_role[]);
  elsif t.user_id <> p_author then
    raise exception 'Ticket not found';
  end if;
  if length(trim(coalesce(p_body, ''))) = 0 then raise exception 'Write a message'; end if;
  insert into ticket_messages (ticket_id, author_id, from_staff, body) values (t.id, p_author, p_staff, trim(p_body));
  update tickets set status = case when p_staff then 'answered' else 'open' end::ticket_status, last_message_at = now(),
         assigned_to = case when p_staff then coalesce(assigned_to, p_author) else assigned_to end
   where id = t.id;
  if p_staff then
    insert into audit_log (actor_id, actor_role, action, entity, entity_id) values (p_author, v_role::text, 'ticket.reply', 'tickets', t.id::text);
  end if;
  return case when p_staff then 'answered' else 'open' end;
end $$;

create or replace function public.ticket_close(p_ticket uuid, p_actor uuid, p_staff boolean) returns text
language plpgsql security definer set search_path = public as $$
declare t tickets%rowtype; v_role staff_role;
begin
  select * into t from tickets where id = p_ticket for update;
  if not found or (not p_staff and t.user_id <> p_actor) then raise exception 'Ticket not found'; end if;
  if p_staff then v_role := require_staff(p_actor, array['owner', 'compliance', 'finance', 'support']::staff_role[]); end if;
  update tickets set status = 'closed' where id = t.id;
  insert into audit_log (actor_id, actor_role, action, entity, entity_id)
  values (p_actor, coalesce(v_role::text, 'investor'), 'ticket.close', 'tickets', t.id::text);
  return 'closed';
end $$;

-- ------------------------------------------------------------------ nominee
-- One nominee per investor. The CNIC is encrypted by the server (C50_DATA_KEY); only a hint is shown.
create table if not exists public.nominees (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  full_name  text not null check (length(full_name) between 3 and 80),
  relation   text not null check (relation in ('Spouse', 'Father', 'Mother', 'Son', 'Daughter', 'Brother', 'Sister', 'Other')),
  cnic_enc   text not null,
  cnic_hint  text not null,
  phone      text,
  updated_at timestamptz not null default now()
);

-- The signed-in investor's nominee, without the encrypted CNIC.
create or replace function public.my_nominee() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('name', full_name, 'rel', relation, 'hint', cnic_hint) from nominees where user_id = auth.uid()
$$;
revoke execute on function public.my_nominee() from public, anon;
grant execute on function public.my_nominee() to authenticated, service_role;

-- ------------------------------------------------------------- launch reset
-- Removes one account and everything it owns (money rows, identity records, tickets). Used for the
-- demo account and test accounts before launch. Returns the KYC file paths so the server can delete
-- the files through the Storage API (Supabase doesn't allow deleting them from SQL).
-- The audit log keeps its history.
create or replace function public.purge_user_data(p_uid uuid) returns text[]
language plpgsql security definer set search_path = public as $$
declare v_files text[];
begin
  select coalesce(array_agg(storage_path), '{}') into v_files from kyc_documents where user_id = p_uid;
  perform set_config('c50.ledger_purge', 'on', true);
  -- take this account's share out of the month totals so the books still reconcile
  update month_closes mc
     set total_profit = mc.total_profit - x.pl, total_fees = mc.total_fees - x.fee, holdings = greatest(0, mc.holdings - x.h)
    from (select ref_id, coalesce(sum(amount) filter (where type in ('profit', 'loss')), 0) as pl,
                 coalesce(-sum(amount) filter (where type = 'fee'), 0) as fee, count(distinct holding_id) as h
            from ledger_entries where user_id = p_uid and ref_type = 'month_close' group by ref_id) x
   where to_char(mc.ym, 'YYYY-MM') = x.ref_id;
  delete from affiliate_commissions where affiliate_id = p_uid or member_id = p_uid;
  delete from ledger_entries where user_id = p_uid;
  delete from withdrawals where user_id = p_uid;
  delete from payout_methods where user_id = p_uid;
  delete from payment_events where deposit_id in (select id from deposits where user_id = p_uid);
  delete from deposits where user_id = p_uid;
  delete from kyc_documents where user_id = p_uid;
  delete from kyc_applications where user_id = p_uid;
  delete from tickets where user_id = p_uid;
  delete from holdings where user_id = p_uid;
  delete from auth.users where id = p_uid;
  perform set_config('c50.ledger_purge', 'off', true);
  return v_files;
end $$;

create or replace function public.purge_demo_data() returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid;
begin
  select id into v_uid from auth.users where phone = '923001234567';
  if v_uid is null then return; end if;
  perform purge_user_data(v_uid);
  insert into audit_log (actor_role, action, entity, entity_id, reason)
  values ('system', 'demo.purge', 'auth.users', v_uid::text, 'Demo account and sample money removed');
end $$;

-- Owner, before launch: removes the demo account, then all test money. Refuses if a single live-mode
-- deposit exists, so it can never touch real money. Investor accounts, identity checks and payout
-- methods stay; closed months stay closed (their totals are zeroed to match the empty ledger).
create or replace function public.prepare_for_launch(p_staff uuid, p_confirm text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_demo  uuid := (select id from auth.users where phone = '923001234567');
  v_files text[] := '{}';
  v       jsonb;
begin
  perform require_staff(p_staff, array['owner']::staff_role[]);
  if p_confirm is distinct from 'RESET TEST MONEY' then raise exception 'Type RESET TEST MONEY to confirm'; end if;
  if exists (select 1 from deposits where mode = 'live') then
    raise exception 'Real (live-mode) deposits exist, so nothing was reset';
  end if;
  if v_demo is not null then v_files := purge_user_data(v_demo); end if;
  v := jsonb_build_object('demo_removed', v_demo is not null,
         'ledger_rows', (select count(*) from ledger_entries), 'withdrawals', (select count(*) from withdrawals),
         'deposits', (select count(*) from deposits where status in ('paid', 'pending')),
         'commissions', (select count(*) from affiliate_commissions));
  perform set_config('c50.ledger_purge', 'on', true);
  delete from affiliate_commissions;
  delete from ledger_entries;
  delete from withdrawals;
  delete from notifications where kind in ('deposit', 'withdrawal', 'affiliate', 'month');
  update deposits set status = case when status = 'paid' then 'refunded' else 'expired' end::deposit_status,
         status_note = 'Test money removed before launch'
   where status in ('paid', 'pending');
  update month_closes set holdings = 0, total_profit = 0, total_fees = 0;
  delete from holdings h where not exists (select 1 from ledger_entries l where l.holding_id = h.id);
  perform set_config('c50.ledger_purge', 'off', true);
  insert into audit_log (actor_id, actor_role, action, entity, reason, after)
  values (p_staff, 'owner', 'launch.reset', 'ledger_entries', 'Test money removed before launch', v);
  return v || jsonb_build_object('files', to_jsonb(v_files));
end $$;

-- ------------------------------------------------------------------ settings
-- Owner-only. Each setting is range-checked here so a typo can't set a 500% commission.
create or replace function public.set_setting(p_staff uuid, p_key text, p_value jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role staff_role := require_staff(p_staff, array['owner']::staff_role[]);
  v_old  jsonb;
  v_num  numeric;
begin
  if p_key in ('affiliate_fee_share_rate', 'affiliate_deposit_rate', 'withdrawal_two_approvals_above') then
    begin v_num := (p_value #>> '{}')::numeric; exception when others then raise exception 'Enter a number'; end;
    if v_num is null then raise exception 'Enter a number'; end if;
    if p_key = 'affiliate_fee_share_rate' and (v_num < 0 or v_num > 1) then raise exception 'Fee share must be between 0%% and 100%% of the fee'; end if;
    if p_key = 'affiliate_deposit_rate' and (v_num < 0 or v_num > 0.10) then raise exception 'Deposit commission must be between 0%% and 10%%'; end if;
    if p_key = 'withdrawal_two_approvals_above' and (v_num < 0 or v_num > 100000000) then raise exception 'Enter an amount in rupees'; end if;
    p_value := to_jsonb(v_num);
  elsif p_key = 'bank_account' then
    if jsonb_typeof(p_value) <> 'object' or coalesce(p_value->>'bank', '') = '' or coalesce(p_value->>'title', '') = ''
       or upper(replace(coalesce(p_value->>'iban', ''), ' ', '')) !~ '^PK[0-9]{2}[A-Z]{4}[0-9A-Z]{16}$' then
      raise exception 'Enter the bank, account title and a PK IBAN (24 characters)';
    end if;
    p_value := jsonb_build_object('bank', trim(p_value->>'bank'), 'title', trim(p_value->>'title'),
                                  'iban', upper(replace(p_value->>'iban', ' ', '')));
  else
    raise exception 'Unknown setting %', p_key;
  end if;
  select value into v_old from app_settings where key = p_key;
  insert into app_settings (key, value, updated_at) values (p_key, p_value, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  insert into audit_log (actor_id, actor_role, action, entity, entity_id, before, after)
  values (p_staff, v_role::text, 'settings.set', 'app_settings', p_key, v_old, p_value);
  return p_value;
end $$;

-- ------------------------------------------------------------------ staff
create or replace function public.staff_grant(p_owner uuid, p_email text, p_role staff_role) returns text
language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_old staff_members%rowtype;
begin
  perform require_staff(p_owner, array['owner']::staff_role[]);
  select id into v_uid from auth.users where lower(email) = lower(trim(p_email));
  if v_uid is null then raise exception 'No login with email %. Create it first in Supabase: Authentication > Users > Add user.', trim(p_email); end if;
  if v_uid = p_owner then raise exception 'You can''t change your own role'; end if;
  select * into v_old from staff_members where user_id = v_uid;
  insert into staff_members (user_id, role, active) values (v_uid, p_role, true)
  on conflict (user_id) do update set role = excluded.role, active = true;
  insert into audit_log (actor_id, actor_role, action, entity, entity_id, before, after)
  values (p_owner, 'owner', 'staff.grant', 'staff_members', v_uid::text,
          case when v_old.user_id is not null then jsonb_build_object('role', v_old.role, 'active', v_old.active) end,
          jsonb_build_object('email', lower(trim(p_email)), 'role', p_role));
  return format('%s is now %s staff. They sign in at /admin/login and set up an authenticator.', lower(trim(p_email)), p_role);
end $$;

create or replace function public.staff_revoke(p_owner uuid, p_user uuid) returns text
language plpgsql security definer set search_path = public as $$
begin
  perform require_staff(p_owner, array['owner']::staff_role[]);
  if p_user = p_owner then raise exception 'You can''t remove yourself'; end if;
  update staff_members set active = false where user_id = p_user and active;
  if not found then raise exception 'Not active staff'; end if;
  insert into audit_log (actor_id, actor_role, action, entity, entity_id, after)
  values (p_owner, 'owner', 'staff.revoke', 'staff_members', p_user::text, jsonb_build_object('active', false));
  return 'revoked';
end $$;

-- ------------------------------------------------------------- reconciliation
-- Runs daily (Vercel cron) and on demand. Every check compares two independent records of the same money.
create table if not exists public.reconciliation_runs (
  id      uuid primary key default gen_random_uuid(),
  ran_at  timestamptz not null default clock_timestamp(),
  ok      boolean not null,
  checks  jsonb not null,
  trigger text not null default 'cron'
);
create index if not exists reconciliation_runs_at on public.reconciliation_runs (ran_at desc);

create or replace function public.run_reconciliation(p_trigger text default 'cron') returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c   jsonb := '[]'::jsonb;
  n   numeric;
  m   numeric;
  k   bigint;
  v_ok boolean;
begin
  -- 1. every paid deposit has exactly its ledger entry, and nothing else is booked as a deposit
  select coalesce(sum(amount), 0) into n from deposits where status = 'paid';
  select coalesce(sum(amount), 0) into m from ledger_entries where type = 'deposit' and ref_type = 'deposit';
  select count(*) into k from deposits d where status = 'paid'
     and not exists (select 1 from ledger_entries l where l.idempotency_key = 'dep:' || d.id and l.amount = d.amount);
  c := c || jsonb_build_object('name', 'Deposits match the ledger', 'ok', n = m and k = 0,
             'detail', format('paid deposits Rs %s, ledger Rs %s, missing %s', n, m, k));

  -- 2. paid withdrawals = what left the ledger for them (holdings + affiliate part)
  select coalesce(sum(amount), 0) into n from withdrawals where status = 'paid';
  select coalesce(-sum(amount), 0) into m from ledger_entries where ref_type = 'withdrawal' and type in ('withdrawal', 'affiliate_payout');
  select count(*) into k from withdrawals w where status = 'paid'
     and (select coalesce(-sum(amount), 0) from ledger_entries l where l.ref_type = 'withdrawal' and l.ref_id = w.id::text) <> w.amount;
  c := c || jsonb_build_object('name', 'Withdrawals match the ledger', 'ok', n = m and k = 0,
             'detail', format('paid Rs %s, ledger Rs %s, mismatched %s', n, m, k));

  -- 3. credited commissions are in the ledger once; voided-after-credit ones are reversed
  select count(*) into k from affiliate_commissions a
   where (a.status = 'credited' and not exists (select 1 from ledger_entries l where l.idempotency_key = 'affc:' || a.id and l.amount = a.commission_amount))
      or (a.status = 'void' and exists (select 1 from ledger_entries l where l.idempotency_key = 'affc:' || a.id)
                            and not exists (select 1 from ledger_entries l where l.idempotency_key = 'affv:' || a.id and l.amount = -a.commission_amount))
      or (a.status = 'pending' and exists (select 1 from ledger_entries l where l.idempotency_key = 'affc:' || a.id));
  c := c || jsonb_build_object('name', 'Affiliate commissions match the ledger', 'ok', k = 0, 'detail', format('%s mismatched', k));

  -- 4. each month close total = its ledger entries; each fee = 2.5% of that holding's profit
  select count(*) into k from month_closes mc
   where mc.total_profit <> (select coalesce(sum(amount), 0) from ledger_entries where ref_type = 'month_close' and ref_id = to_char(mc.ym, 'YYYY-MM') and type in ('profit', 'loss'))
      or mc.total_fees <> (select coalesce(-sum(amount), 0) from ledger_entries where ref_type = 'month_close' and ref_id = to_char(mc.ym, 'YYYY-MM') and type = 'fee');
  c := c || jsonb_build_object('name', 'Month closes match the ledger', 'ok', k = 0, 'detail', format('%s months mismatched', k));
  select count(*) into k from ledger_entries f
   where f.type = 'fee' and f.ref_type = 'month_close'
     and -f.amount <> (select round(greatest(coalesce(sum(p.amount), 0), 0) * 0.025, 2) from ledger_entries p
                        where p.holding_id = f.holding_id and p.ref_type = 'month_close' and p.ref_id = f.ref_id and p.type = 'profit');
  c := c || jsonb_build_object('name', 'Every fee is 2.5% of profit', 'ok', k = 0, 'detail', format('%s fees off', k));

  -- 5. no negative balances, and money in review never exceeds the balance
  select count(*) into k from (select holding_id from ledger_entries where holding_id is not null group by holding_id having sum(amount) < 0) x;
  c := c || jsonb_build_object('name', 'No negative holdings', 'ok', k = 0, 'detail', format('%s negative', k));
  select count(*) into k from (
    select w.user_id from withdrawals w where w.status in ('requested', 'approved') group by w.user_id
    having sum(w.amount) > (select coalesce(sum(amount), 0) from ledger_entries l where l.user_id = w.user_id)) x;
  c := c || jsonb_build_object('name', 'Withdrawals in review are covered', 'ok', k = 0, 'detail', format('%s investors over', k));

  -- 6. deposits stuck: paid at the provider but still pending here for over a day (needs a look)
  select count(*) into k from deposits where status = 'pending' and method <> 'bank' and created_at < now() - interval '1 day'
     and exists (select 1 from payment_events e where e.deposit_id = deposits.id and e.signature_ok);
  c := c || jsonb_build_object('name', 'No paid-but-pending deposits', 'ok', k = 0, 'detail', format('%s to check', k));

  select bool_and((x->>'ok')::boolean) into v_ok from jsonb_array_elements(c) x;
  insert into reconciliation_runs (ok, checks, trigger) values (v_ok, c, left(coalesce(p_trigger, 'cron'), 20));
  if not v_ok then
    insert into audit_log (actor_role, action, entity, reason, after)
    values ('system', 'reconcile.fail', 'reconciliation_runs', 'Daily reconciliation found a mismatch', c);
  end if;
  return jsonb_build_object('ok', v_ok, 'checks', c);
end $$;

-- ------------------------------------------------------------------ overview
create or replace function public.admin_overview() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'investors',        (select count(*) from profiles p where not exists (select 1 from staff_members s where s.user_id = p.user_id)),
    'verified',         (select count(distinct user_id) from kyc_applications where status = 'verified'),
    'invested',         (select coalesce(sum(amount), 0) from ledger_entries where holding_id is not null),
    'affiliate_owed',   (select coalesce(sum(amount), 0) from ledger_entries where holding_id is null),
    'deposits_month',   (select coalesce(sum(amount), 0) from deposits where status = 'paid'
                          and paid_at >= date_trunc('month', now() at time zone 'Asia/Karachi') at time zone 'Asia/Karachi'),
    'paid_out_month',   (select coalesce(sum(amount), 0) from withdrawals where status = 'paid'
                          and paid_at >= date_trunc('month', now() at time zone 'Asia/Karachi') at time zone 'Asia/Karachi'),
    'kyc_review',       (select count(*) from kyc_applications where status = 'review'),
    'bank_pending',     (select count(*) from deposits where status = 'pending' and method = 'bank'),
    'wd_open',          (select count(*) from withdrawals where status in ('requested', 'approved')),
    'wd_open_amount',   (select coalesce(sum(amount), 0) from withdrawals where status in ('requested', 'approved')),
    'tickets_open',     (select count(*) from tickets where status = 'open'),
    'frozen',           (select count(*) from profiles where frozen_at is not null),
    'last_close',       (select to_char(max(ym), 'YYYY-MM') from month_closes),
    'fees_total',       (select coalesce(-sum(amount), 0) from ledger_entries where type = 'fee'),
    'commission_total', (select coalesce(sum(commission_amount), 0) from affiliate_commissions where status = 'credited'),
    'reconcile',        (select jsonb_build_object('ok', ok, 'at', ran_at, 'checks', checks, 'stale', ran_at < now() - interval '36 hours')
                           from reconciliation_runs order by ran_at desc limit 1),
    'demo_present',     exists (select 1 from auth.users where phone = '923001234567'))
$$;

-- Staff search: name, mobile (any format), email or invite code. Staff accounts aren't listed.
create or replace function public.admin_users(p_q text, p_filter text default null, p_limit int default 50) returns table (
  user_id uuid, full_name text, phone text, email text, referral_code text, created_at timestamptz,
  kyc text, balance numeric, members bigint, frozen boolean, affiliate_blocked boolean)
language sql stable security definer set search_path = public as $$
  with q as (select nullif(trim(coalesce(p_q, '')), '') as t,
                    nullif(regexp_replace(coalesce(p_q, ''), '[^0-9]', '', 'g'), '') as d)
  select p.user_id, p.full_name, p.phone, p.email, p.referral_code, p.created_at,
         coalesce((select k.status::text from kyc_applications k where k.user_id = p.user_id order by k.created_at desc limit 1), 'none'),
         coalesce((select sum(amount) from ledger_entries l where l.user_id = p.user_id), 0),
         (select count(*) from profiles m where m.referred_by = p.id),
         p.frozen_at is not null, p.affiliate_blocked_at is not null
    from profiles p, q
   where not exists (select 1 from staff_members s where s.user_id = p.user_id)
     and (q.t is null
          or p.full_name ilike '%' || q.t || '%' or p.email ilike '%' || q.t || '%' or p.referral_code = upper(q.t)
          or (length(q.d) >= 4 and p.phone like '%' || right(q.d, 10) || '%'))
     and (p_filter is null or (p_filter = 'frozen' and p.frozen_at is not null) or (p_filter = 'blocked' and p.affiliate_blocked_at is not null))
   order by p.created_at desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200)
$$;

-- ---------------------------------------------------------------------- RLS
alter table public.tickets             enable row level security;
alter table public.ticket_messages     enable row level security;
alter table public.nominees            enable row level security;
alter table public.reconciliation_runs enable row level security;

drop policy if exists tickets_own on public.tickets;
create policy tickets_own on public.tickets for select to authenticated using (user_id = auth.uid());
drop policy if exists ticket_messages_own on public.ticket_messages;
create policy ticket_messages_own on public.ticket_messages for select to authenticated
  using (exists (select 1 from public.tickets t where t.id = ticket_id and t.user_id = auth.uid()));
revoke insert, update, delete on public.tickets, public.ticket_messages from anon, authenticated;
revoke all on public.nominees, public.reconciliation_runs from anon, authenticated;

do $$ declare f text; begin
  foreach f in array array['staff_role_of(uuid)', 'require_staff(uuid,staff_role[])',
    'set_strategy_return(uuid,text,date,numeric,return_status,text)', 'preview_month_close(date)', 'staff_close_month(uuid,date)',
    'open_ticket(uuid,text,text,text)', 'ticket_reply(uuid,uuid,boolean,text)', 'ticket_close(uuid,uuid,boolean)',
    'set_setting(uuid,text,jsonb)', 'staff_grant(uuid,text,staff_role)', 'staff_revoke(uuid,uuid)',
    'run_reconciliation(text)', 'admin_overview()', 'admin_users(text,text,int)',
    'purge_user_data(uuid)', 'purge_demo_data()', 'prepare_for_launch(uuid,text)'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
