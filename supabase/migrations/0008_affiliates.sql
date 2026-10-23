-- Capital 50 AI — Phase 6: affiliates (PRODUCTION-BRIEF §3.5, §5.3) plus account freeze. Safe to re-run.
-- Commissions are company money paid to the affiliate; nothing is ever taken from a member.
--   fee share : affiliate_fee_share_rate (default 15%) of the 2.5% fee charged on a member's profit,
--               credited inside close_month().
--   deposits  : affiliate_deposit_rate (default 0%, owner sets it) of a member's deposit, pending until
--               the deposit's first month closes; void if the member withdraws before then.

alter table public.profiles add column if not exists affiliate_blocked_at timestamptz;
alter table public.profiles add column if not exists frozen_at timestamptz;
alter table public.profiles add column if not exists frozen_reason text;

insert into public.app_settings (key, value) values
  ('affiliate_fee_share_rate', '0.15'),
  ('affiliate_deposit_rate', '0')
on conflict (key) do nothing;

create or replace function public.setting_num(p_key text, p_default numeric) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::numeric from app_settings where key = p_key), p_default)
$$;

-- ------------------------------------------------------------- invite codes
-- Every code a person has ever used keeps resolving to them; a code can never pass to someone else.
create table if not exists public.affiliate_codes (
  code       text primary key check (code ~ '^[A-Z0-9]{4,12}$'),
  user_id    uuid not null references auth.users(id) on delete cascade,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists affiliate_codes_user on public.affiliate_codes (user_id);
insert into public.affiliate_codes (code, user_id)
  select referral_code, user_id from public.profiles on conflict (code) do nothing;

create or replace function public.make_referral_code(p_name text) returns text
language plpgsql as $$
declare
  base text := left(regexp_replace(upper(coalesce(p_name, '')), '[^A-Z]', '', 'g'), 6);
  candidate text;
begin
  if length(base) < 2 then base := 'C50'; end if;
  loop
    candidate := base || lpad((floor(random() * 90) + 10)::int::text, 2, '0');
    exit when not exists (select 1 from public.profiles where referral_code = candidate)
          and not exists (select 1 from public.affiliate_codes where code = candidate);
    base := left(base, 5) || chr(65 + floor(random() * 26)::int);
  end loop;
  return candidate;
end $$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  meta     jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_phone  text  := case when new.phone is null or new.phone = '' then null
                         else '+' || ltrim(new.phone, '+') end;
  v_email  text  := nullif(lower(trim(coalesce(meta->>'email', new.email, ''))), '');
  v_ref    text  := upper(regexp_replace(coalesce(meta->>'ref', ''), '[^A-Za-z0-9]', '', 'g'));
  v_code   text  := public.make_referral_code(meta->>'full_name');
  v_referrer uuid;
  v_profile  uuid;
begin
  if v_ref <> '' then
    select p.id into v_referrer from public.affiliate_codes c join public.profiles p on p.user_id = c.user_id
     where c.code = v_ref and (p.phone is distinct from v_phone);   -- no self-referral
  end if;

  insert into public.profiles (user_id, full_name, phone, email, referral_code, referred_by, referred_at)
  values (new.id, trim(coalesce(meta->>'full_name', '')), v_phone, v_email, v_code, v_referrer,
          case when v_referrer is not null then now() end)
  returning id into v_profile;
  insert into public.affiliate_codes (code, user_id) values (v_code, new.id);

  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, after)
  values (new.id, 'investor', 'profile.create', 'profiles', v_profile::text,
          jsonb_build_object('phone', v_phone, 'referred_by', v_referrer, 'ref', nullif(v_ref, '')));
  return new;
end $$;

-- Change your invite code (4-12 letters/numbers). Old codes keep working for you.
create or replace function public.set_referral_code(p_user uuid, p_code text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v text := upper(trim(coalesce(p_code, '')));
begin
  if v !~ '^[A-Z0-9]{4,12}$' then raise exception 'Use 4–12 letters or numbers, no spaces.'; end if;
  if v in ('ADMIN', 'CAPITAL50', 'SUPPORT', 'C50AI', 'CAPITAL', 'STAFF', 'OFFICIAL', 'C50') then raise exception 'That code is reserved.'; end if;
  if exists (select 1 from affiliate_codes where code = v and user_id <> p_user) then raise exception 'That code is taken. Try another.'; end if;
  insert into affiliate_codes (code, user_id) values (v, p_user) on conflict (code) do nothing;
  update profiles set referral_code = v where user_id = p_user;
  insert into audit_log (actor_id, actor_role, action, entity, entity_id, after)
  values (p_user, 'investor', 'affiliate.code', 'profiles', p_user::text, jsonb_build_object('code', v));
  return v;
end $$;

-- ------------------------------------------------------------- commissions
do $$ begin
  create type public.commission_kind as enum ('fee_share', 'deposit');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.commission_status as enum ('pending', 'credited', 'void');
exception when duplicate_object then null; end $$;

create table if not exists public.affiliate_commissions (
  id                uuid primary key default gen_random_uuid(),
  affiliate_id      uuid not null references auth.users(id) on delete restrict,
  member_id         uuid not null references auth.users(id) on delete restrict,
  kind              public.commission_kind not null,
  ym                date not null check (extract(day from ym) = 1),
  base_amount       numeric(18,2) not null,         -- the fee charged, or the deposit
  rate              numeric(6,4) not null,
  commission_amount numeric(18,2) not null check (commission_amount > 0),
  status            public.commission_status not null default 'pending',
  void_reason       text,
  source_id         text not null,
  idempotency_key   text not null unique,
  credited_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists affiliate_commissions_aff on public.affiliate_commissions (affiliate_id, ym);
create index if not exists affiliate_commissions_member on public.affiliate_commissions (member_id);
drop trigger if exists affiliate_commissions_updated on public.affiliate_commissions;
create trigger affiliate_commissions_updated before update on public.affiliate_commissions
  for each row execute function public.set_updated_at();

-- The affiliate who referred this member, if commissions may be paid on them.
create or replace function public.commission_affiliate(p_member uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select a.user_id from profiles m join profiles a on a.id = m.referred_by
   where m.user_id = p_member and a.affiliate_blocked_at is null and a.user_id <> m.user_id
$$;

-- Same verified CNIC on both sides = self-referral.
create or replace function public.same_person(p_a uuid, p_b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from kyc_applications x join kyc_applications y on x.cnic_hash = y.cnic_hash
                  where x.user_id = p_a and y.user_id = p_b and x.status = 'verified' and y.status = 'verified')
$$;

create or replace function public.credit_commission(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c affiliate_commissions%rowtype;
begin
  select * into c from affiliate_commissions where id = p_id for update;
  if c.status <> 'pending' then return; end if;
  insert into ledger_entries (user_id, type, amount, ym, ref_type, ref_id, idempotency_key, meta)
  values (c.affiliate_id, 'affiliate_commission', c.commission_amount, c.ym, 'affiliate_commission', c.id::text,
          'affc:' || c.id, jsonb_build_object('kind', c.kind, 'member', c.member_id))
  on conflict (idempotency_key) do nothing;
  update affiliate_commissions set status = 'credited', credited_at = now() where id = p_id;
end $$;

-- Called by close_month() for each fee charged.
create or replace function public.affiliate_on_fee(p_member uuid, p_holding uuid, p_ym date, p_fee numeric) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_aff  uuid := commission_affiliate(p_member);
  v_rate numeric := setting_num('affiliate_fee_share_rate', 0.15);
  v_amt  numeric := round(p_fee * v_rate, 2);
  v_id   uuid;
begin
  if v_aff is null or v_amt <= 0 then return; end if;
  insert into affiliate_commissions (affiliate_id, member_id, kind, ym, base_amount, rate, commission_amount, source_id, idempotency_key,
                                     status, void_reason)
  values (v_aff, p_member, 'fee_share', p_ym, p_fee, v_rate, v_amt, p_holding::text,
          format('aff:fee:%s:%s', to_char(p_ym, 'YYYY-MM'), p_holding),
          case when same_person(v_aff, p_member) then 'void' else 'pending' end::commission_status,
          case when same_person(v_aff, p_member) then 'Self-referral (same CNIC)' end)
  on conflict (idempotency_key) do nothing
  returning id into v_id;
  if v_id is not null then perform credit_commission(v_id); end if;
end $$;

-- Called by credit_deposit(): pending until the deposit's first month closes.
create or replace function public.affiliate_on_deposit(p_deposit uuid, p_effective_ym date) returns void
language plpgsql security definer set search_path = public as $$
declare
  d      deposits%rowtype;
  v_aff  uuid;
  v_rate numeric := setting_num('affiliate_deposit_rate', 0);
begin
  if v_rate <= 0 then return; end if;
  select * into d from deposits where id = p_deposit;
  v_aff := commission_affiliate(d.user_id);
  if v_aff is null or round(d.amount * v_rate, 2) <= 0 then return; end if;
  insert into affiliate_commissions (affiliate_id, member_id, kind, ym, base_amount, rate, commission_amount, source_id, idempotency_key)
  values (v_aff, d.user_id, 'deposit', p_effective_ym, d.amount, v_rate, round(d.amount * v_rate, 2), d.id::text, 'aff:dep:' || d.id)
  on conflict (idempotency_key) do nothing;
end $$;

-- Called by close_month(): deposit commissions whose first month just closed are credited, unless the
-- member asked to withdraw since the deposit or it's a self-referral.
create or replace function public.affiliate_settle_deposits(p_ym date) returns void
language plpgsql security definer set search_path = public as $$
declare c record;
begin
  for c in select ac.*, d.paid_at from affiliate_commissions ac join deposits d on d.id::text = ac.source_id
            where ac.kind = 'deposit' and ac.status = 'pending' and ac.ym <= p_ym loop
    if exists (select 1 from withdrawals w where w.user_id = c.member_id and w.created_at >= c.paid_at
                and w.status in ('requested', 'approved', 'paid')) then
      update affiliate_commissions set status = 'void', void_reason = 'Member withdrew before the deposit''s first month closed' where id = c.id;
    elsif same_person(c.affiliate_id, c.member_id) then
      update affiliate_commissions set status = 'void', void_reason = 'Self-referral (same CNIC)' where id = c.id;
    else
      perform credit_commission(c.id);
    end if;
  end loop;
end $$;

-- Staff: void a commission. If it was already credited, a reversing adjustment is written (the ledger
-- is never edited).
create or replace function public.void_commission(p_id uuid, p_staff uuid, p_reason text) returns text
language plpgsql security definer set search_path = public as $$
declare
  c      affiliate_commissions%rowtype;
  v_role staff_role;
begin
  select role into v_role from staff_members where user_id = p_staff and active;
  if v_role is null or v_role not in ('owner', 'compliance', 'finance') then raise exception 'Only owner, compliance or finance staff can void commissions'; end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'Give a reason'; end if;
  select * into c from affiliate_commissions where id = p_id for update;
  if not found then raise exception 'Commission not found'; end if;
  if c.status = 'void' then return 'void'; end if;
  if c.status = 'credited' then
    insert into ledger_entries (user_id, type, amount, ym, ref_type, ref_id, idempotency_key, meta)
    values (c.affiliate_id, 'adjustment', -c.commission_amount, date_trunc('month', now() at time zone 'Asia/Karachi')::date,
            'commission_void', c.id::text, 'affv:' || c.id, jsonb_build_object('reason', trim(p_reason)));
  end if;
  update affiliate_commissions set status = 'void', void_reason = trim(p_reason) where id = p_id;
  insert into audit_log (actor_id, actor_role, action, entity, entity_id, before, after, reason)
  values (p_staff, v_role::text, 'affiliate.void', 'affiliate_commissions', p_id::text,
          jsonb_build_object('status', c.status), jsonb_build_object('status', 'void', 'amount', c.commission_amount), trim(p_reason));
  return 'void';
end $$;

-- Staff: block/unblock an affiliate (no new commissions while blocked) or freeze/unfreeze an investor
-- (no deposits, payout changes or withdrawals while frozen).
create or replace function public.set_account_flag(p_user uuid, p_staff uuid, p_flag text, p_on boolean, p_reason text) returns text
language plpgsql security definer set search_path = public as $$
declare v_role staff_role;
begin
  select role into v_role from staff_members where user_id = p_staff and active;
  if v_role is null or v_role not in ('owner', 'compliance') then raise exception 'Only owner or compliance staff can do this'; end if;
  if p_on and length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'Give a reason'; end if;
  if p_flag = 'freeze' then
    update profiles set frozen_at = case when p_on then now() end, frozen_reason = case when p_on then trim(p_reason) end where user_id = p_user;
  elsif p_flag = 'block_affiliate' then
    update profiles set affiliate_blocked_at = case when p_on then now() end where user_id = p_user;
  else raise exception 'Unknown flag'; end if;
  insert into audit_log (actor_id, actor_role, action, entity, entity_id, after, reason)
  values (p_staff, v_role::text, 'account.' || p_flag || case when p_on then '' else '_off' end, 'profiles', p_user::text,
          jsonb_build_object('on', p_on), nullif(trim(coalesce(p_reason, '')), ''));
  return case when p_on then 'on' else 'off' end;
end $$;

create or replace function public.account_frozen(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select frozen_at is not null from profiles where user_id = p_user), false)
$$;

-- ------------------------------------------------------------- leaderboard
-- Computed only from credited commissions; nobody can type a name or an amount into it.
-- Shows "Affiliate #XXXX" unless the affiliate opted in to first name + last initial.
create or replace function public.affiliate_leaderboard(p_from date) returns table (
  user_id uuid, display_name text, members bigint, commission numeric, first_credit timestamptz)
language sql stable security definer set search_path = public as $$
  select c.affiliate_id,
         case when p.leaderboard_opt_in and p.full_name <> ''
              then split_part(p.full_name, ' ', 1) || ' ' || left(split_part(p.full_name, ' ', array_length(string_to_array(p.full_name, ' '), 1)), 1) || '.'
              else 'Affiliate #' || upper(left(md5(c.affiliate_id::text), 4)) end,
         (select count(*) from profiles m where m.referred_by = p.id),
         sum(c.commission_amount), min(c.credited_at)
    from affiliate_commissions c join profiles p on p.user_id = c.affiliate_id
   where c.status = 'credited' and c.ym >= p_from and p.affiliate_blocked_at is null
   group by c.affiliate_id, p.id, p.leaderboard_opt_in, p.full_name
   order by sum(c.commission_amount) desc, min(c.credited_at)
$$;

-- ---------------------------------------------------------------------- RLS
alter table public.affiliate_codes enable row level security;
alter table public.affiliate_commissions enable row level security;
drop policy if exists affiliate_codes_own on public.affiliate_codes;
create policy affiliate_codes_own on public.affiliate_codes for select to authenticated using (user_id = auth.uid());
drop policy if exists affiliate_commissions_own on public.affiliate_commissions;
create policy affiliate_commissions_own on public.affiliate_commissions for select to authenticated using (affiliate_id = auth.uid());
revoke insert, update, delete on public.affiliate_codes, public.affiliate_commissions from anon, authenticated;

do $$ declare f text; begin
  foreach f in array array['setting_num(text,numeric)', 'set_referral_code(uuid,text)', 'commission_affiliate(uuid)', 'same_person(uuid,uuid)',
    'credit_commission(uuid)', 'affiliate_on_fee(uuid,uuid,date,numeric)', 'affiliate_on_deposit(uuid,date)', 'affiliate_settle_deposits(date)',
    'void_commission(uuid,uuid,text)', 'set_account_flag(uuid,uuid,text,boolean,text)', 'account_frozen(uuid)', 'affiliate_leaderboard(date)'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
