-- Capital 50 AI — Phase 1 foundation (PRODUCTION-BRIEF §4, §12.1)
-- profiles, strategies, strategy_returns, audit_log + RLS + new-user trigger.
-- Safe to re-run.

create extension if not exists pgcrypto;

-- An earlier placeholder schema (profiles.phone_number + otp_sessions) never held real
-- users. Remove it so the brief's schema can be created. Only fires on that exact shape.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'profiles' and column_name = 'phone_number')
     and exists (select 1 from information_schema.tables
                 where table_schema = 'public' and table_name = 'otp_sessions') then
    drop table if exists public.notifications, public.audit_log, public.otp_sessions,
      public.deposits, public.withdrawals, public.payout_methods, public.affiliate_commissions,
      public.affiliate_codes, public.kyc_documents, public.kyc_applications, public.ledger_entries,
      public.holdings, public.strategy_returns, public.strategies, public.profiles cascade;
  end if;
end $$;

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------- strategies
create table if not exists public.strategies (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9_-]+$'),
  name        text not null,
  kind        text not null,
  sort_order  int  not null,
  min_deposit numeric(18,2) not null default 5000,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------- strategy_returns
-- The single source of truth for every return figure shown anywhere.
do $$ begin
  create type public.return_status as enum ('draft', 'mtd', 'published');
exception when duplicate_object then null; end $$;

create table if not exists public.strategy_returns (
  id           uuid primary key default gen_random_uuid(),
  strategy_id  uuid not null references public.strategies(id),
  ym           date not null check (extract(day from ym) = 1),
  return_pct   numeric(7,3) not null,
  status       public.return_status not null default 'draft',
  source_note  text not null check (length(trim(source_note)) > 0),
  published_at timestamptz,
  published_by uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (strategy_id, ym)
);

-- ------------------------------------------------------------------ profiles
create table if not exists public.profiles (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null unique references auth.users(id) on delete cascade,
  full_name          text not null default '',
  phone              text unique check (phone ~ '^\+923[0-9]{9}$'),
  email              text,
  city               text,
  referral_code      text not null unique check (referral_code ~ '^[A-Z0-9]{4,12}$'),
  referred_by        uuid references public.profiles(id) on delete set null,
  referred_at        timestamptz,
  leaderboard_opt_in boolean not null default false,
  hide_balances      boolean not null default false,
  prefs              jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index if not exists profiles_email_lower_key on public.profiles (lower(email));
-- Deleting an account must not be blocked by the members it referred.
alter table public.profiles drop constraint if exists profiles_referred_by_fkey;
alter table public.profiles add constraint profiles_referred_by_fkey
  foreign key (referred_by) references public.profiles(id) on delete set null;

-- ----------------------------------------------------------------- audit_log
-- Immutable: no update or delete, for anyone.
create table if not exists public.audit_log (
  id         uuid primary key default gen_random_uuid(),
  actor_id   uuid,
  actor_role text,
  action     text not null,
  entity     text not null,
  entity_id  text,
  before     jsonb,
  after      jsonb,
  reason     text,
  ip         inet,
  at         timestamptz not null default now()
);

create or replace function public.audit_log_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end $$;

drop trigger if exists audit_log_no_change on public.audit_log;
create trigger audit_log_no_change before update or delete on public.audit_log
  for each row execute function public.audit_log_immutable();
drop trigger if exists audit_log_no_truncate on public.audit_log;
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function public.audit_log_immutable();

-- ------------------------------------------------------------ updated_at hooks
drop trigger if exists strategies_updated on public.strategies;
create trigger strategies_updated before update on public.strategies
  for each row execute function public.set_updated_at();
drop trigger if exists strategy_returns_updated on public.strategy_returns;
create trigger strategy_returns_updated before update on public.strategy_returns
  for each row execute function public.set_updated_at();
drop trigger if exists profiles_updated on public.profiles;
create trigger profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------- new user -> profile
-- Runs when Supabase Auth creates a user. Metadata comes from the sign-up call:
-- { full_name, email, ref }. The referral is resolved here, never trusted from the client.
create or replace function public.make_referral_code(p_name text) returns text
language plpgsql as $$
declare
  base text := left(regexp_replace(upper(coalesce(p_name, '')), '[^A-Z]', '', 'g'), 6);
  candidate text;
begin
  if length(base) < 2 then base := 'C50'; end if;
  loop
    candidate := base || lpad((floor(random() * 90) + 10)::int::text, 2, '0');
    exit when not exists (select 1 from public.profiles where referral_code = candidate);
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
  v_referrer uuid;
  v_profile  uuid;
begin
  if v_ref <> '' then
    select id into v_referrer from public.profiles
     where referral_code = v_ref
       and (phone is distinct from v_phone);   -- no self-referral
  end if;

  insert into public.profiles (user_id, full_name, phone, email, referral_code, referred_by, referred_at)
  values (new.id,
          trim(coalesce(meta->>'full_name', '')),
          v_phone,
          v_email,
          public.make_referral_code(meta->>'full_name'),
          v_referrer,
          case when v_referrer is not null then now() end)
  returning id into v_profile;

  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, after)
  values (new.id, 'investor', 'profile.create', 'profiles', v_profile::text,
          jsonb_build_object('phone', v_phone, 'referred_by', v_referrer));
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------- RLS
alter table public.strategies       enable row level security;
alter table public.strategy_returns enable row level security;
alter table public.profiles         enable row level security;
alter table public.audit_log        enable row level security;

drop policy if exists strategies_public_read on public.strategies;
create policy strategies_public_read on public.strategies
  for select to anon, authenticated using (active);

drop policy if exists strategy_returns_public_read on public.strategy_returns;
create policy strategy_returns_public_read on public.strategy_returns
  for select to anon, authenticated using (status in ('mtd', 'published'));

drop policy if exists profiles_own_read on public.profiles;
create policy profiles_own_read on public.profiles
  for select to authenticated using (user_id = auth.uid());

-- Writes go through the service role / staff RPCs only.
revoke insert, update, delete on public.strategies, public.strategy_returns, public.profiles
  from anon, authenticated;
revoke all on public.audit_log from anon, authenticated;
revoke execute on function public.handle_new_user(), public.make_referral_code(text)
  from public, anon, authenticated;
