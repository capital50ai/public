-- Capital 50 AI — Phase 4: deposits (PRODUCTION-BRIEF §5.4). Safe to re-run.
-- A deposit is credited exactly once, only by credit_deposit(): from a signature-verified provider
-- notification or from two-person staff confirmation of a bank transfer. Never from a browser redirect.

do $$ begin
  create type public.deposit_method as enum ('jazzcash', 'easypaisa', 'bank', 'usdt');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.deposit_status as enum ('pending', 'paid', 'failed', 'expired', 'refunded');
exception when duplicate_object then null; end $$;

create table if not exists public.deposits (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete restrict,
  strategy_id   uuid not null references public.strategies(id),
  amount        numeric(18,2) not null check (amount >= 5000 and amount <= 10000000),
  method        public.deposit_method not null,
  status        public.deposit_status not null default 'pending',
  reference     text not null unique,              -- our order reference (bank memo / provider order id)
  provider_ref  text unique,                       -- provider's transaction id, once known
  mode          text not null default 'sandbox' check (mode in ('sandbox', 'live')),
  meta          jsonb not null default '{}'::jsonb, -- e.g. USDT rate and invoice
  approvals     jsonb not null default '[]'::jsonb, -- bank transfer confirmations
  status_note   text,
  paid_at       timestamptz,
  effective_ym  date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists deposits_user on public.deposits (user_id, created_at desc);
create index if not exists deposits_pending on public.deposits (method, status, created_at);

drop trigger if exists deposits_updated on public.deposits;
create trigger deposits_updated before update on public.deposits
  for each row execute function public.set_updated_at();

-- Every provider notification and staff action, exactly as received. Append-only.
create table if not exists public.payment_events (
  id           uuid primary key default gen_random_uuid(),
  provider     text not null,
  deposit_id   uuid references public.deposits(id),
  signature_ok boolean not null,
  outcome      text not null,
  payload      jsonb not null,
  received_at  timestamptz not null default now()
);
create index if not exists payment_events_deposit on public.payment_events (deposit_id, received_at);
drop trigger if exists payment_events_no_change on public.payment_events;
create trigger payment_events_no_change before update or delete on public.payment_events
  for each row execute function public.audit_log_immutable();

-- Company settings readable by the server (e.g. the bank account investors pay into).
create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
insert into public.app_settings (key, value) values
  ('bank_account', '{"bank":"","title":"","iban":"","note":"Set your company bank account: update app_settings where key = ''bank_account''."}')
on conflict (key) do nothing;

-- ------------------------------------------------------------- credit
-- Money paid during a month starts earning the next month (brief §5.1 rule 6). One place to change it.
create or replace function public.deposit_effective_ym(p_paid_at timestamptz) returns date
language sql stable as $$
  select (date_trunc('month', p_paid_at at time zone 'Asia/Karachi') + interval '1 month')::date
$$;

-- Marks a pending deposit paid and writes its ledger entry. Calling it again returns the same
-- result and writes nothing (so replayed notifications are harmless).
create or replace function public.credit_deposit(p_deposit uuid, p_actor uuid, p_source text, p_provider_ref text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  d       deposits%rowtype;
  v_hold  uuid;
  v_ym    date;
  v_now   timestamptz := now();
begin
  select * into d from deposits where id = p_deposit for update;
  if not found then raise exception 'Deposit not found'; end if;
  if d.status = 'paid' then
    return jsonb_build_object('status', 'paid', 'already', true, 'effective_ym', to_char(d.effective_ym, 'YYYY-MM'));
  end if;
  if d.status <> 'pending' then
    raise exception 'Deposit % is %, not pending', d.reference, d.status;
  end if;

  v_ym := deposit_effective_ym(v_now);
  insert into holdings (user_id, strategy_id) values (d.user_id, d.strategy_id)
  on conflict (user_id, strategy_id) do nothing;
  select id into v_hold from holdings where user_id = d.user_id and strategy_id = d.strategy_id;

  update deposits set status = 'paid', paid_at = v_now, effective_ym = v_ym,
         provider_ref = coalesce(p_provider_ref, provider_ref)
   where id = d.id;

  insert into ledger_entries (user_id, holding_id, type, amount, ym, ref_type, ref_id, idempotency_key, meta)
  values (d.user_id, v_hold, 'deposit', d.amount, v_ym, 'deposit', d.id::text, 'dep:' || d.id,
          jsonb_build_object('method', d.method, 'reference', d.reference, 'source', p_source,
                             'day', extract(day from v_now at time zone 'Asia/Karachi')::int));

  insert into audit_log (actor_id, actor_role, action, entity, entity_id, after)
  values (p_actor, case when p_actor is null then 'system' else 'staff' end, 'deposit.credit', 'deposits', d.id::text,
          jsonb_build_object('amount', d.amount, 'method', d.method, 'source', p_source,
                             'provider_ref', p_provider_ref, 'effective_ym', to_char(v_ym, 'YYYY-MM')));
  return jsonb_build_object('status', 'paid', 'already', false, 'effective_ym', to_char(v_ym, 'YYYY-MM'));
end $$;

-- Pending -> failed/expired (from a verified provider notification or staff). Paid deposits are untouched.
create or replace function public.close_deposit(p_deposit uuid, p_status deposit_status, p_actor uuid, p_note text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  d deposits%rowtype;
begin
  if p_status not in ('failed', 'expired') then raise exception 'close_deposit only fails or expires'; end if;
  select * into d from deposits where id = p_deposit for update;
  if not found then raise exception 'Deposit not found'; end if;
  if d.status <> 'pending' then return d.status::text; end if;
  update deposits set status = p_status, status_note = p_note where id = d.id;
  insert into audit_log (actor_id, actor_role, action, entity, entity_id, after, reason)
  values (p_actor, case when p_actor is null then 'system' else 'staff' end, 'deposit.' || p_status, 'deposits',
          d.id::text, jsonb_build_object('amount', d.amount, 'method', d.method), p_note);
  return p_status::text;
end $$;

-- Bank transfers: two different owner/finance staff confirm the same bank statement reference.
-- The second confirmation credits the deposit.
create or replace function public.confirm_bank_deposit(p_deposit uuid, p_staff uuid, p_bank_ref text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  d      deposits%rowtype;
  v_role staff_role;
  v_ref  text := upper(regexp_replace(coalesce(p_bank_ref, ''), '\s', '', 'g'));
  v_first jsonb;
begin
  select role into v_role from staff_members where user_id = p_staff and active;
  if v_role is null or v_role not in ('owner', 'finance') then
    raise exception 'Only owner or finance staff can confirm bank deposits';
  end if;
  if length(v_ref) < 4 then raise exception 'Enter the transaction reference from the bank statement'; end if;

  select * into d from deposits where id = p_deposit for update;
  if not found then raise exception 'Deposit not found'; end if;
  if d.method <> 'bank' then raise exception 'Not a bank transfer'; end if;
  if d.status <> 'pending' then raise exception 'Deposit is %, not pending', d.status; end if;
  if d.user_id = p_staff then raise exception 'Staff cannot confirm their own deposit'; end if;

  v_first := d.approvals -> 0;
  if v_first is null then
    update deposits set approvals = jsonb_build_array(jsonb_build_object('staff', p_staff, 'bank_ref', v_ref, 'at', now()))
     where id = d.id;
    insert into audit_log (actor_id, actor_role, action, entity, entity_id, after)
    values (p_staff, v_role::text, 'deposit.bank_confirm_1', 'deposits', d.id::text, jsonb_build_object('bank_ref', v_ref));
    return jsonb_build_object('status', 'pending', 'confirmations', 1);
  end if;

  if (v_first->>'staff')::uuid = p_staff then
    raise exception 'A second, different staff member must confirm this deposit';
  end if;
  if v_first->>'bank_ref' <> v_ref then
    raise exception 'Bank reference does not match the first confirmation (%)', v_first->>'bank_ref';
  end if;
  update deposits set approvals = approvals || jsonb_build_array(jsonb_build_object('staff', p_staff, 'bank_ref', v_ref, 'at', now()))
   where id = d.id;
  insert into audit_log (actor_id, actor_role, action, entity, entity_id, after)
  values (p_staff, v_role::text, 'deposit.bank_confirm_2', 'deposits', d.id::text, jsonb_build_object('bank_ref', v_ref));
  return credit_deposit(d.id, p_staff, 'bank_two_person', 'BANK:' || v_ref);
end $$;

-- ---------------------------------------------------------------------- RLS
alter table public.deposits       enable row level security;
alter table public.payment_events enable row level security;
alter table public.app_settings   enable row level security;

drop policy if exists deposits_own_read on public.deposits;
create policy deposits_own_read on public.deposits
  for select to authenticated using (user_id = auth.uid());

revoke insert, update, delete on public.deposits from anon, authenticated;
revoke all on public.payment_events, public.app_settings from anon, authenticated;
revoke execute on function public.credit_deposit(uuid, uuid, text, text),
                           public.close_deposit(uuid, deposit_status, uuid, text),
                           public.confirm_bank_deposit(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.credit_deposit(uuid, uuid, text, text),
                          public.close_deposit(uuid, deposit_status, uuid, text),
                          public.confirm_bank_deposit(uuid, uuid, text)
  to service_role;
