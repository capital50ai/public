-- Capital 50 AI — Phase 5: payout methods and withdrawals (PRODUCTION-BRIEF §3.4, §5.5). Safe to re-run.
-- Money leaves the ledger only in pay_withdrawal(): after KYC, a 24-hour-old payout method in the
-- investor's verified name, an SMS code, staff approval (two people above the threshold) and a
-- payment reference. Every step is audit-logged.

do $$ begin
  create type public.payout_type as enum ('jazz', 'easy', 'bank', 'usdt');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.withdrawal_status as enum ('requested', 'approved', 'paid', 'rejected', 'cancelled');
exception when duplicate_object then null; end $$;

create table if not exists public.payout_methods (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete restrict,
  type           public.payout_type not null,
  account_enc    text not null,                 -- AES-256-GCM, key held by the server (C50_DATA_KEY)
  account_hint   text not null,                 -- e.g. "0300 •••• 4567", safe to show
  account_hash   text not null,                 -- keyed hash, to spot the same account twice
  bank           text,
  title          text not null,
  title_verified boolean not null default false,
  ready_at       timestamptz not null default now() + interval '24 hours',
  disabled_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists payout_methods_user on public.payout_methods (user_id);
create unique index if not exists payout_methods_once on public.payout_methods (user_id, account_hash) where disabled_at is null;
drop trigger if exists payout_methods_updated on public.payout_methods;
create trigger payout_methods_updated before update on public.payout_methods
  for each row execute function public.set_updated_at();

create table if not exists public.withdrawals (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete restrict,
  payout_method_id uuid not null references public.payout_methods(id),
  amount           numeric(18,2) not null check (amount >= 1000),
  status           public.withdrawal_status not null default 'requested',
  needs_approvals  int not null check (needs_approvals in (1, 2)),
  approvals        jsonb not null default '[]'::jsonb,
  tx_ref           text unique,
  reason           text,
  otp_verified_at  timestamptz not null,
  paid_at          timestamptz,
  paid_by          uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists withdrawals_user on public.withdrawals (user_id, created_at desc);
create index if not exists withdrawals_open on public.withdrawals (status, created_at);
drop trigger if exists withdrawals_updated on public.withdrawals;
create trigger withdrawals_updated before update on public.withdrawals
  for each row execute function public.set_updated_at();

insert into public.app_settings (key, value) values ('withdrawal_two_approvals_above', '100000')
on conflict (key) do nothing;

-- ------------------------------------------------------------- balances
create or replace function public.ledger_balance(p_user uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0) from ledger_entries where user_id = p_user
$$;

-- What the investor can withdraw now: the ledger balance minus withdrawals already requested/approved.
create or replace function public.available_to_withdraw(p_user uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select ledger_balance(p_user)
       - coalesce((select sum(amount) from withdrawals where user_id = p_user and status in ('requested', 'approved')), 0)
$$;

create or replace function public.kyc_verified(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select status = 'verified' from kyc_applications where user_id = p_user
                   order by created_at desc limit 1), false)
$$;

-- ------------------------------------------------------------- request
create or replace function public.request_withdrawal(p_user uuid, p_method uuid, p_amount numeric, p_otp_at timestamptz)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  m        payout_methods%rowtype;
  v_limit  numeric;
  v_id     uuid;
begin
  perform pg_advisory_xact_lock(hashtext('c50.wd.' || p_user));  -- one money action per investor at a time
  if not kyc_verified(p_user) then raise exception 'Verify your identity (CNIC) before withdrawing'; end if;
  if account_frozen(p_user) then raise exception 'Your account is on hold. Please contact support.'; end if;
  if p_otp_at is null or p_otp_at < now() - interval '10 minutes' then raise exception 'Confirm with the code sent to your phone'; end if;
  select * into m from payout_methods where id = p_method and user_id = p_user and disabled_at is null;
  if not found then raise exception 'Choose one of your payout methods'; end if;
  if m.ready_at > now() then raise exception 'This payout method unlocks at %', to_char(m.ready_at at time zone 'Asia/Karachi', 'DD Mon HH24:MI'); end if;
  if not m.title_verified then raise exception 'This account is not in your verified name'; end if;
  if p_amount is null or p_amount < 1000 then raise exception 'Minimum withdrawal is Rs 1,000'; end if;
  if p_amount <> round(p_amount, 2) then raise exception 'Invalid amount'; end if;
  if p_amount > available_to_withdraw(p_user) then raise exception 'That is more than your available balance'; end if;

  select coalesce((value #>> '{}')::numeric, 100000) into v_limit from app_settings where key = 'withdrawal_two_approvals_above';
  insert into withdrawals (user_id, payout_method_id, amount, needs_approvals, otp_verified_at)
  values (p_user, p_method, p_amount, case when p_amount > coalesce(v_limit, 100000) then 2 else 1 end, p_otp_at)
  returning id into v_id;
  insert into audit_log (actor_id, actor_role, action, entity, entity_id, after)
  values (p_user, 'investor', 'withdrawal.request', 'withdrawals', v_id::text,
          jsonb_build_object('amount', p_amount, 'method', m.type, 'account', m.account_hint));
  return v_id;
end $$;

create or replace function public.cancel_withdrawal(p_user uuid, p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  w withdrawals%rowtype;
begin
  select * into w from withdrawals where id = p_id and user_id = p_user for update;
  if not found then raise exception 'Withdrawal not found'; end if;
  if w.status <> 'requested' then raise exception 'This withdrawal is already %', w.status; end if;
  update withdrawals set status = 'cancelled' where id = p_id;
  insert into audit_log (actor_id, actor_role, action, entity, entity_id, after)
  values (p_user, 'investor', 'withdrawal.cancel', 'withdrawals', p_id::text, jsonb_build_object('amount', w.amount));
  return 'cancelled';
end $$;

-- ------------------------------------------------------------- staff
create or replace function public.staff_money_role(p_staff uuid) returns staff_role
language plpgsql stable security definer set search_path = public as $$
declare v staff_role;
begin
  select role into v from staff_members where user_id = p_staff and active;
  if v is null or v not in ('owner', 'finance') then raise exception 'Only owner or finance staff can do this'; end if;
  return v;
end $$;

create or replace function public.approve_withdrawal(p_id uuid, p_staff uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role staff_role := staff_money_role(p_staff);
  w      withdrawals%rowtype;
  v_n    int;
begin
  select * into w from withdrawals where id = p_id for update;
  if not found then raise exception 'Withdrawal not found'; end if;
  if w.status <> 'requested' then raise exception 'Withdrawal is %, not waiting for approval', w.status; end if;
  if w.user_id = p_staff then raise exception 'Staff cannot approve their own withdrawal'; end if;
  if exists (select 1 from jsonb_array_elements(w.approvals) a where (a->>'staff')::uuid = p_staff) then
    raise exception 'A second, different staff member must approve this withdrawal';
  end if;
  if not kyc_verified(w.user_id) then raise exception 'Investor is no longer KYC verified'; end if;
  if account_frozen(w.user_id) then raise exception 'Investor account is frozen'; end if;
  if ledger_balance(w.user_id) < (select sum(amount) from withdrawals where user_id = w.user_id and status in ('requested', 'approved')) then
    raise exception 'Balance no longer covers this withdrawal';
  end if;

  v_n := jsonb_array_length(w.approvals) + 1;
  update withdrawals
     set approvals = approvals || jsonb_build_array(jsonb_build_object('staff', p_staff, 'at', now())),
         status = case when v_n >= needs_approvals then 'approved'::withdrawal_status else status end
   where id = p_id;
  insert into audit_log (actor_id, actor_role, action, entity, entity_id, after)
  values (p_staff, v_role::text, 'withdrawal.approve', 'withdrawals', p_id::text,
          jsonb_build_object('approvals', v_n, 'needed', w.needs_approvals, 'amount', w.amount));
  return jsonb_build_object('approvals', v_n, 'needed', w.needs_approvals,
                            'status', case when v_n >= w.needs_approvals then 'approved' else 'requested' end);
end $$;

create or replace function public.reject_withdrawal(p_id uuid, p_staff uuid, p_reason text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_role staff_role := staff_money_role(p_staff);
  w      withdrawals%rowtype;
begin
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'Give a reason the investor can act on'; end if;
  select * into w from withdrawals where id = p_id for update;
  if not found then raise exception 'Withdrawal not found'; end if;
  if w.status not in ('requested', 'approved') then raise exception 'Withdrawal is already %', w.status; end if;
  update withdrawals set status = 'rejected', reason = trim(p_reason) where id = p_id;
  insert into audit_log (actor_id, actor_role, action, entity, entity_id, after, reason)
  values (p_staff, v_role::text, 'withdrawal.reject', 'withdrawals', p_id::text, jsonb_build_object('amount', w.amount), trim(p_reason));
  return 'rejected';
end $$;

-- Money leaves here: split across the investor's holdings in proportion to their value, dated the
-- current month (withdrawn money does not earn that month's result). Waits until last month is closed,
-- so a loss can never be booked on money already paid out.
create or replace function public.pay_withdrawal(p_id uuid, p_staff uuid, p_tx_ref text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role  staff_role := staff_money_role(p_staff);
  w       withdrawals%rowtype;
  v_ref   text := upper(regexp_replace(coalesce(p_tx_ref, ''), '\s', '', 'g'));
  v_ym    date := date_trunc('month', now() at time zone 'Asia/Karachi')::date;
  v_prev  date := (date_trunc('month', now() at time zone 'Asia/Karachi') - interval '1 month')::date;
  v_total numeric;
  v_aff   numeric;
  v_need  numeric;
  v_hold  numeric;
  v_left  numeric;
  v_share numeric;
  h       record;
  v_n     int;
  v_i     int := 0;
begin
  if length(v_ref) < 4 then raise exception 'Enter the payment transaction reference'; end if;
  select * into w from withdrawals where id = p_id for update;
  if not found then raise exception 'Withdrawal not found'; end if;
  if w.status = 'paid' then return jsonb_build_object('status', 'paid', 'already', true); end if;
  if w.status <> 'approved' then raise exception 'Withdrawal is %, it must be approved first', w.status; end if;
  if exists (select 1 from withdrawals where tx_ref = v_ref and id <> w.id) then
    raise exception 'Transaction reference % was already used for another withdrawal', v_ref;
  end if;
  perform pg_advisory_xact_lock(hashtext('c50.wd.' || w.user_id));
  if not kyc_verified(w.user_id) then raise exception 'Investor is no longer KYC verified'; end if;
  if account_frozen(w.user_id) then raise exception 'Investor account is frozen'; end if;
  if not exists (select 1 from payout_methods where id = w.payout_method_id and disabled_at is null and title_verified) then
    raise exception 'The payout method was removed or is not verified';
  end if;
  if not exists (select 1 from month_closes where ym = v_prev)
     and exists (select 1 from ledger_entries where user_id = w.user_id and ym <= v_prev) then
    raise exception 'Close % before paying withdrawals, so its result is booked first', to_char(v_prev, 'YYYY-MM');
  end if;

  -- affiliate earnings (no holding) are paid out first, the rest from holdings in proportion to value;
  -- the largest holding goes last and takes the rounding remainder
  select coalesce(sum(amount), 0) into v_aff from ledger_entries where user_id = w.user_id and holding_id is null;
  select coalesce(sum(value), 0), count(*) into v_total, v_n
    from (select sum(amount) as value from ledger_entries
           where user_id = w.user_id and holding_id is not null group by holding_id having sum(amount) > 0) x;
  if v_total + greatest(v_aff, 0) < w.amount then raise exception 'Balance no longer covers this withdrawal'; end if;

  v_left := w.amount;
  if v_aff > 0 then
    v_share := least(v_aff, w.amount);
    insert into ledger_entries (user_id, type, amount, ym, ref_type, ref_id, idempotency_key, meta)
    values (w.user_id, 'affiliate_payout', -v_share, v_ym, 'withdrawal', w.id::text, format('wd:%s:aff', w.id),
            jsonb_build_object('source', 'withdrawal', 'tx_ref', v_ref, 'day', extract(day from now() at time zone 'Asia/Karachi')::int));
    v_left := v_left - v_share;
  end if;
  v_need := v_left;   -- what the holdings still have to cover
  v_hold := v_total;

  for h in select holding_id, sum(amount) as value from ledger_entries
            where user_id = w.user_id and holding_id is not null
            group by holding_id having sum(amount) > 0 order by 2, 1 loop
    v_i := v_i + 1;
    v_share := case when v_i = v_n then v_left else least(h.value, round(v_need * h.value / v_hold, 2)) end;
    if v_share > 0 then
      insert into ledger_entries (user_id, holding_id, type, amount, ym, ref_type, ref_id, idempotency_key, meta)
      values (w.user_id, h.holding_id, 'withdrawal', -v_share, v_ym, 'withdrawal', w.id::text,
              format('wd:%s:%s', w.id, h.holding_id),
              jsonb_build_object('source', 'withdrawal', 'tx_ref', v_ref,
                                 'day', extract(day from now() at time zone 'Asia/Karachi')::int));
    end if;
    v_left := v_left - v_share;
  end loop;

  update withdrawals set status = 'paid', tx_ref = v_ref, paid_at = now(), paid_by = p_staff where id = w.id;
  insert into audit_log (actor_id, actor_role, action, entity, entity_id, after)
  values (p_staff, v_role::text, 'withdrawal.paid', 'withdrawals', w.id::text,
          jsonb_build_object('amount', w.amount, 'tx_ref', v_ref, 'ym', to_char(v_ym, 'YYYY-MM')));
  return jsonb_build_object('status', 'paid', 'already', false);
end $$;

-- ---------------------------------------------------------------------- RLS
alter table public.payout_methods enable row level security;
alter table public.withdrawals    enable row level security;

drop policy if exists payout_methods_own_read on public.payout_methods;
create policy payout_methods_own_read on public.payout_methods
  for select to authenticated using (user_id = auth.uid());
drop policy if exists withdrawals_own_read on public.withdrawals;
create policy withdrawals_own_read on public.withdrawals
  for select to authenticated using (user_id = auth.uid());

-- investors never see the encrypted account or its hash, only the hint
revoke select on public.payout_methods from authenticated;
grant select (id, user_id, type, account_hint, bank, title, title_verified, ready_at, disabled_at, created_at)
  on public.payout_methods to authenticated;
revoke insert, update, delete on public.payout_methods, public.withdrawals from anon, authenticated;

revoke execute on function public.ledger_balance(uuid), public.available_to_withdraw(uuid), public.kyc_verified(uuid),
  public.request_withdrawal(uuid, uuid, numeric, timestamptz), public.cancel_withdrawal(uuid, uuid),
  public.staff_money_role(uuid), public.approve_withdrawal(uuid, uuid), public.reject_withdrawal(uuid, uuid, text),
  public.pay_withdrawal(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.ledger_balance(uuid), public.available_to_withdraw(uuid), public.kyc_verified(uuid),
  public.request_withdrawal(uuid, uuid, numeric, timestamptz), public.cancel_withdrawal(uuid, uuid),
  public.approve_withdrawal(uuid, uuid), public.reject_withdrawal(uuid, uuid, text), public.pay_withdrawal(uuid, uuid, text)
  to service_role;
