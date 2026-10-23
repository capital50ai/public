-- Capital 50 AI — Phase 7 hardening: trusted devices, notifications from real events. Safe to re-run.

-- ------------------------------------------------------------- trusted devices
-- A browser that passed an SMS code once. Logging in from any other browser asks for a code.
-- Only a hash of the device cookie is stored.
create table if not exists public.trusted_devices (
  user_id      uuid not null references auth.users(id) on delete cascade,
  device_hash  text not null,
  label        text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (user_id, device_hash)
);
alter table public.trusted_devices enable row level security;
revoke all on public.trusted_devices from anon, authenticated;

-- ------------------------------------------------------------- notifications
-- Written by triggers when something happens to an investor's money or account, so nothing can be
-- missed or invented. In-app now; sms_sent_at / email_sent_at are there for the SMS and email sender.
create table if not exists public.notifications (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  kind          text not null,            -- deposit | withdrawal | kyc | affiliate | month | support
  icon          text not null,
  title         text not null,
  body          text not null default '',
  link          text not null default '#overview',
  dedupe_key    text unique,
  created_at    timestamptz not null default clock_timestamp(),
  read_at       timestamptz,
  sms_sent_at   timestamptz,
  email_sent_at timestamptz
);
create index if not exists notifications_user on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;
drop policy if exists notifications_own on public.notifications;
create policy notifications_own on public.notifications for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on public.notifications from anon, authenticated;

create or replace function public.notify(p_user uuid, p_kind text, p_icon text, p_title text, p_body text, p_link text, p_key text)
returns void language sql security definer set search_path = public as $$
  insert into notifications (user_id, kind, icon, title, body, link, dedupe_key)
  values (p_user, p_kind, p_icon, p_title, coalesce(p_body, ''), p_link, p_key)
  on conflict (dedupe_key) do nothing
$$;

create or replace function public.rs_text(n numeric) returns text language sql immutable as $$
  select 'Rs ' || regexp_replace(to_char(n, 'FM999,999,999,990.00'), '\.00$', '')
$$;

-- deposits: credited / failed / expired
create or replace function public.notify_deposit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'paid' then
      perform notify(new.user_id, 'deposit', 'circle-check', 'Deposit received',
        format('%s added. It starts earning in %s.', rs_text(new.amount), to_char(new.effective_ym, 'FMMonth YYYY')),
        '#wallet', 'dep:' || new.id || ':paid');
    elsif new.status in ('failed', 'expired') then
      perform notify(new.user_id, 'deposit', 'x', 'Deposit not completed',
        format('%s (%s): nothing was charged to your balance.', rs_text(new.amount), new.reference), '#wallet', 'dep:' || new.id || ':' || new.status);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists deposits_notify on public.deposits;
create trigger deposits_notify after update on public.deposits for each row execute function public.notify_deposit();

-- withdrawals: approved / paid / rejected
create or replace function public.notify_withdrawal() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'approved' then
      perform notify(new.user_id, 'withdrawal', 'check', 'Withdrawal approved', format('%s is being sent to your account.', rs_text(new.amount)), '#wallet', 'wd:' || new.id || ':approved');
    elsif new.status = 'paid' then
      perform notify(new.user_id, 'withdrawal', 'banknote', 'Withdrawal sent', format('%s sent. Reference %s.', rs_text(new.amount), coalesce(new.tx_ref, '')), '#wallet', 'wd:' || new.id || ':paid');
    elsif new.status = 'rejected' then
      perform notify(new.user_id, 'withdrawal', 'x', 'Withdrawal not approved', format('%s: %s', rs_text(new.amount), coalesce(new.reason, '')), '#wallet', 'wd:' || new.id || ':rejected');
    end if;
  end if;
  return new;
end $$;
drop trigger if exists withdrawals_notify on public.withdrawals;
create trigger withdrawals_notify after update on public.withdrawals for each row execute function public.notify_withdrawal();

-- identity check decided
create or replace function public.notify_kyc() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'verified' then
      perform notify(new.user_id, 'kyc', 'badge-check', 'Identity verified', 'You can now add payout methods and withdraw.', '#kyc', 'kyc:' || new.id || ':verified');
    elsif new.status = 'rejected' then
      perform notify(new.user_id, 'kyc', 'shield-alert', 'Identity check not approved', coalesce(new.rejection_reason, 'Please check your details and try again.'), '#kyc', 'kyc:' || new.id || ':rejected');
    end if;
  end if;
  return new;
end $$;
drop trigger if exists kyc_notify on public.kyc_applications;
create trigger kyc_notify after update on public.kyc_applications for each row execute function public.notify_kyc();

-- affiliate commission credited
create or replace function public.notify_commission() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'credited' and old.status is distinct from 'credited' then
    perform notify(new.affiliate_id, 'affiliate', 'gift', 'Affiliate commission credited',
      format('%s from a member''s %s %s.', rs_text(new.commission_amount), case when new.kind = 'deposit' then 'deposit in' else 'fee for' end, to_char(new.ym, 'FMMonth YYYY')),
      '#affiliate', 'affc:' || new.id);
  end if;
  return new;
end $$;
drop trigger if exists commissions_notify on public.affiliate_commissions;
create trigger commissions_notify after update on public.affiliate_commissions for each row execute function public.notify_commission();

-- a new member signed up with your code
create or replace function public.notify_member() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.referred_by is not null then
    perform notify((select user_id from profiles where id = new.referred_by), 'affiliate', 'users', 'New member joined with your link',
      coalesce(nullif(initcap(split_part(trim(new.full_name), ' ', 1)), ''), 'A new member') || ' · not invested yet', '#affiliate', 'member:' || new.id);
  end if;
  return new;
end $$;
drop trigger if exists profiles_notify_member on public.profiles;
create trigger profiles_notify_member after insert on public.profiles for each row execute function public.notify_member();

-- staff replied to a ticket
create or replace function public.notify_ticket() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.from_staff then
    perform notify(t.user_id, 'support', 'mail', 'Support replied', format('#%s · %s', t.ref, t.subject), '#support', 'tm:' || new.id)
      from tickets t where t.id = new.ticket_id;
  end if;
  return new;
end $$;
drop trigger if exists ticket_messages_notify on public.ticket_messages;
create trigger ticket_messages_notify after insert on public.ticket_messages for each row execute function public.notify_ticket();

-- month closed: each investor's own result for the month
create or replace function public.notify_month_close() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform notify(x.user_id, 'month', 'calendar', to_char(new.ym, 'FMMonth YYYY') || ' results booked',
           case when x.pl >= 0 then format('Profit %s added to your balance (after the 2.5%% fee %s).', rs_text(x.pl - x.fee), rs_text(x.fee))
                else format('Loss of %s this month. No fee was charged.', rs_text(-x.pl)) end,
           '#wallet', 'month:' || to_char(new.ym, 'YYYY-MM') || ':' || x.user_id)
    from (select user_id, sum(amount) filter (where type in ('profit', 'loss')) as pl, coalesce(-sum(amount) filter (where type = 'fee'), 0) as fee
            from ledger_entries where ref_type = 'month_close' and ref_id = to_char(new.ym, 'YYYY-MM') group by user_id) x
   where x.pl is not null;
  return new;
end $$;
drop trigger if exists month_closes_notify on public.month_closes;
create trigger month_closes_notify after insert on public.month_closes for each row execute function public.notify_month_close();

-- The signed-in investor marks everything read.
create or replace function public.mark_notifications_read() returns void
language sql security definer set search_path = public as $$
  update notifications set read_at = now() where user_id = auth.uid() and read_at is null
$$;

revoke execute on function public.notify(uuid, text, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.mark_notifications_read() from public, anon;
grant execute on function public.mark_notifications_read() to authenticated;

-- ------------------------------------------------------------- public policies
-- The home page's "Company & policies" texts (terms, privacy, complaints, ...). Owner-written (ideally
-- lawyer-reviewed); a policy shows as published only when the owner publishes it.
insert into public.app_settings (key, value) values ('policies', '{}') on conflict (key) do nothing;

create or replace function public.set_policy(p_staff uuid, p_id text, p_text text, p_published boolean) returns text
language plpgsql security definer set search_path = public as $$
declare v_old jsonb;
begin
  perform require_staff(p_staff, array['owner']::staff_role[]);
  if p_id not in ('company', 'contact', 'how', 'strategies', 'fees', 'deposits', 'custody', 'risks', 'eligibility', 'terms', 'privacy', 'complaints') then
    raise exception 'Unknown policy';
  end if;
  if length(coalesce(p_text, '')) > 30000 then raise exception 'Too long (30,000 characters max)'; end if;
  if p_published and length(trim(coalesce(p_text, ''))) < 50 then raise exception 'Write the policy before publishing it'; end if;
  if p_published and p_text ~ '\[[A-Z][^\]]*\]' then raise exception 'Fill in every [BRACKETED] placeholder before publishing'; end if;
  select value -> p_id into v_old from app_settings where key = 'policies';
  update app_settings set value = value || jsonb_build_object(p_id, jsonb_build_object(
           'text', trim(coalesce(p_text, '')), 'published', p_published, 'at', to_char(now() at time zone 'Asia/Karachi', 'DD Mon YYYY'))),
         updated_at = now()
   where key = 'policies';
  insert into audit_log (actor_id, actor_role, action, entity, entity_id, before, after)
  values (p_staff, 'owner', 'policy.' || case when p_published then 'publish' else 'save' end, 'app_settings', p_id,
          case when v_old is not null then jsonb_build_object('published', v_old->'published', 'length', length(v_old->>'text')) end,
          jsonb_build_object('published', p_published, 'length', length(trim(coalesce(p_text, '')))));
  return case when p_published then 'published' else 'saved' end;
end $$;
revoke execute on function public.set_policy(uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.set_policy(uuid, text, text, boolean) to service_role;
