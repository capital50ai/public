-- Capital 50 AI — Phase 2: holdings, append-only ledger, month close (PRODUCTION-BRIEF §4, §5.1)
-- Balances are sums of ledger_entries. Nothing ever updates or deletes a ledger row.
-- Safe to re-run.

-- ------------------------------------------------------------------ holdings
create table if not exists public.holdings (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete restrict,
  strategy_id uuid not null references public.strategies(id),
  opened_at   timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, strategy_id)
);

drop trigger if exists holdings_updated on public.holdings;
create trigger holdings_updated before update on public.holdings
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------ ledger_entries
do $$ begin
  create type public.ledger_type as enum
    ('deposit', 'withdrawal', 'profit', 'loss', 'fee', 'affiliate_commission', 'affiliate_payout', 'adjustment');
exception when duplicate_object then null; end $$;

-- `ym` is the month an entry belongs to. For a deposit or withdrawal it is the first month the
-- money counts in; for profit/loss/fee it is the month that was closed.
create table if not exists public.ledger_entries (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete restrict,
  holding_id      uuid references public.holdings(id) on delete restrict,
  type            public.ledger_type not null,
  amount          numeric(18,2) not null check (amount <> 0),
  ym              date not null check (extract(day from ym) = 1),
  ref_type        text,
  ref_id          text,
  idempotency_key text not null unique,
  meta            jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  constraint ledger_sign check (
    (type in ('deposit', 'profit', 'affiliate_commission') and amount > 0) or
    (type in ('withdrawal', 'loss', 'fee', 'affiliate_payout') and amount < 0) or
    type = 'adjustment'),
  constraint ledger_holding_required check (
    holding_id is not null or type in ('affiliate_commission', 'affiliate_payout', 'adjustment'))
);
create index if not exists ledger_entries_user_ym on public.ledger_entries (user_id, ym);
create index if not exists ledger_entries_holding_ym on public.ledger_entries (holding_id, ym);

-- ------------------------------------------------------------- month_closes
create table if not exists public.month_closes (
  ym           date primary key check (extract(day from ym) = 1),
  closed_at    timestamptz not null default now(),
  closed_by    uuid references auth.users(id),
  holdings     int not null,
  total_profit numeric(18,2) not null,
  total_fees   numeric(18,2) not null
);

-- ---------------------------------------------------------- ledger guards
-- Append-only. The only exception is purge_demo_data(), which sets a transaction-local flag.
create or replace function public.ledger_append_only() returns trigger
language plpgsql as $$
begin
  if current_setting('c50.ledger_purge', true) = 'on' then
    return old;
  end if;
  raise exception 'ledger_entries is append-only';
end $$;

drop trigger if exists ledger_no_change on public.ledger_entries;
create trigger ledger_no_change before update or delete on public.ledger_entries
  for each row execute function public.ledger_append_only();
drop trigger if exists ledger_no_truncate on public.ledger_entries;
create trigger ledger_no_truncate before truncate on public.ledger_entries
  for each statement execute function public.audit_log_immutable();

-- Money can't be added to (or taken from) a month that is already closed, and a deposit can't
-- slip in while a close is running.
create or replace function public.ledger_check_open_month() returns trigger
language plpgsql as $$
declare
  v_last date;
begin
  if new.type in ('deposit', 'withdrawal') then
    perform pg_advisory_xact_lock(hashtext('c50.month_close'));
    select max(ym) into v_last from public.month_closes;
    if v_last is not null and new.ym <= v_last then
      raise exception 'Month % is already closed; % must count from a later month',
        to_char(new.ym, 'YYYY-MM'), new.type;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists ledger_open_month on public.ledger_entries;
create trigger ledger_open_month before insert on public.ledger_entries
  for each row execute function public.ledger_check_open_month();

-- -------------------------------------------------------------- month close
-- For each holding open in month p_ym, with r = the published return for that strategy/month:
--   value_start = everything before p_ym + deposits/withdrawals that count from p_ym
--   profit      = round(value_start × r / 100, 2)          (negative = loss)
--   fee         = round(max(0, profit) × 2.5%, 2)
-- Writes profit|loss and fee entries keyed close:{ym}:{holding}:{type}. Re-running is a no-op.
-- Affiliate commissions are added in Phase 6.
create or replace function public.close_month(p_ym date, p_actor uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ym     text := to_char(p_ym, 'YYYY-MM');
  v_last   date;
  h        record;
  v_start  numeric(18,2);
  v_r      numeric(7,3);
  v_profit numeric(18,2);
  v_fee    numeric(18,2);
  v_n      int := 0;
  v_tp     numeric(18,2) := 0;
  v_tf     numeric(18,2) := 0;
  v_result jsonb;
begin
  if p_ym is null or extract(day from p_ym) <> 1 then
    raise exception 'close_month needs the first day of a month, got %', p_ym;
  end if;
  perform pg_advisory_xact_lock(hashtext('c50.month_close'));

  if exists (select 1 from month_closes where ym = p_ym) then
    select jsonb_build_object('ym', v_ym, 'already_closed', true, 'holdings', holdings,
                              'total_profit', total_profit, 'total_fees', total_fees)
      into v_result from month_closes where ym = p_ym;
    return v_result;
  end if;

  select max(ym) into v_last from month_closes;
  if v_last is not null and p_ym < v_last then
    raise exception 'Cannot close %: % is already closed', v_ym, to_char(v_last, 'YYYY-MM');
  end if;
  -- no gaps: every month after the first close must be closed in order
  if v_last is not null and p_ym <> (v_last + interval '1 month')::date then
    raise exception 'Close % first', to_char(v_last + interval '1 month', 'YYYY-MM');
  end if;
  if p_ym >= date_trunc('month', now() at time zone 'Asia/Karachi')::date then
    raise exception 'Cannot close %: the month has not ended yet', v_ym;
  end if;

  for h in
    select ho.id, ho.user_id, ho.strategy_id, s.slug
      from holdings ho join strategies s on s.id = ho.strategy_id
     order by ho.id
  loop
    select coalesce(sum(amount), 0) into v_start
      from ledger_entries
     where holding_id = h.id
       and (ym < p_ym or (ym = p_ym and type in ('deposit', 'withdrawal')));
    continue when v_start <= 0;

    select return_pct into v_r from strategy_returns
     where strategy_id = h.strategy_id and ym = p_ym and status = 'published';
    if v_r is null then
      raise exception 'No published % return for %; publish it before closing the month', h.slug, v_ym;
    end if;

    v_profit := round(v_start * v_r / 100, 2);
    v_fee    := round(greatest(v_profit, 0) * 0.025, 2);

    if v_profit <> 0 then
      insert into ledger_entries (user_id, holding_id, type, amount, ym, ref_type, ref_id, idempotency_key, meta)
      values (h.user_id, h.id, case when v_profit > 0 then 'profit' else 'loss' end::ledger_type, v_profit, p_ym,
              'month_close', v_ym,
              format('close:%s:%s:%s', v_ym, h.id, case when v_profit > 0 then 'profit' else 'loss' end),
              jsonb_build_object('r', v_r, 'value_start', v_start))
      on conflict (idempotency_key) do nothing;
    end if;
    if v_fee > 0 then
      insert into ledger_entries (user_id, holding_id, type, amount, ym, ref_type, ref_id, idempotency_key, meta)
      values (h.user_id, h.id, 'fee', -v_fee, p_ym, 'month_close', v_ym,
              format('close:%s:%s:fee', v_ym, h.id),
              jsonb_build_object('rate', 0.025, 'profit', v_profit))
      on conflict (idempotency_key) do nothing;
    end if;

    v_n  := v_n + 1;
    v_tp := v_tp + v_profit;
    v_tf := v_tf + v_fee;
  end loop;

  insert into month_closes (ym, closed_by, holdings, total_profit, total_fees)
  values (p_ym, p_actor, v_n, v_tp, v_tf);

  v_result := jsonb_build_object('ym', v_ym, 'already_closed', false, 'holdings', v_n,
                                 'total_profit', v_tp, 'total_fees', v_tf);
  insert into audit_log (actor_id, actor_role, action, entity, entity_id, after)
  values (p_actor, case when p_actor is null then 'system' else 'staff' end,
          'month.close', 'month_closes', v_ym, v_result);
  return v_result;
end $$;

-- ------------------------------------------------------------- demo purge
-- Removes the demo investor (mobile 300 1234567) and every ledger row it has. Run before launch:
--   select public.purge_demo_data();
create or replace function public.purge_demo_data() returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid;
begin
  select id into v_uid from auth.users where phone = '923001234567';
  if v_uid is null then return; end if;
  perform set_config('c50.ledger_purge', 'on', true);
  delete from ledger_entries where user_id = v_uid;
  delete from holdings where user_id = v_uid;
  delete from auth.users where id = v_uid;
  perform set_config('c50.ledger_purge', 'off', true);
  insert into audit_log (actor_role, action, entity, entity_id, reason)
  values ('system', 'demo.purge', 'auth.users', v_uid::text, 'Demo account and sample money removed');
end $$;

-- ---------------------------------------------------------------------- RLS
alter table public.holdings       enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.month_closes   enable row level security;

drop policy if exists holdings_own_read on public.holdings;
create policy holdings_own_read on public.holdings
  for select to authenticated using (user_id = auth.uid());

drop policy if exists ledger_own_read on public.ledger_entries;
create policy ledger_own_read on public.ledger_entries
  for select to authenticated using (user_id = auth.uid());

drop policy if exists month_closes_read on public.month_closes;
create policy month_closes_read on public.month_closes
  for select to authenticated using (true);

revoke insert, update, delete on public.holdings, public.ledger_entries, public.month_closes
  from anon, authenticated;
revoke execute on function public.close_month(date, uuid) from public, anon, authenticated;
revoke execute on function public.purge_demo_data() from public, anon, authenticated;
grant execute on function public.close_month(date, uuid) to service_role;
