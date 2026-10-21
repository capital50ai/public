-- Demo investor account: mobile 300 1234567, password Demo#2026.
-- Safe to re-run: an existing demo account just gets its password reset.
-- Delete this account before launch (PRODUCTION-BRIEF §9).
do $$
declare
  v_phone text := '923001234567';
  v_uid   uuid;
begin
  select id into v_uid from auth.users where phone = v_phone;
  if v_uid is null then
    v_uid := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, phone, phone_confirmed_at, encrypted_password,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      phone_change, phone_change_token, email_change_token_current, reauthentication_token)
    values (
      '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
      v_phone, now(), extensions.crypt('Demo#2026', extensions.gen_salt('bf')),
      '{"provider":"phone","providers":["phone"]}',
      jsonb_build_object('full_name', 'Demo Investor', 'email', 'demo@capital50.ai', 'risk_ack_at', now()),
      now(), now(), '', '', '', '', '', '', '', '');
    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (v_uid::text, v_uid,
            jsonb_build_object('sub', v_uid::text, 'phone', v_phone, 'email_verified', false, 'phone_verified', true),
            'phone', now(), now(), now());
  else
    update auth.users
       set encrypted_password = extensions.crypt('Demo#2026', extensions.gen_salt('bf')),
           phone_confirmed_at = coalesce(phone_confirmed_at, now()),
           updated_at = now()
     where id = v_uid;
  end if;
end $$;

-- Demo money: the same sample deposits the dashboard preview used, followed by real month
-- closes, so the demo dashboard shows figures produced by the production ledger.
-- Re-running adds nothing. purge_demo_data() removes all of it.
do $$
declare
  v_uid uuid;
  v_h   uuid;
  d     record;
  m     date;
begin
  select id into v_uid from auth.users where phone = '923001234567';
  for d in select * from (values ('kitchen', date '2026-07-01', 25000, 1), ('gold', date '2026-07-01', 15000, 1),
                                 ('crypto',  date '2026-07-01', 10000, 1), ('sat',  date '2026-09-01', 20000, 4))
                    as v(slug, ym, amt, day) loop
    insert into public.holdings (user_id, strategy_id)
      select v_uid, id from public.strategies where slug = d.slug
      on conflict (user_id, strategy_id) do nothing;
    select h.id into v_h from public.holdings h join public.strategies s on s.id = h.strategy_id
     where h.user_id = v_uid and s.slug = d.slug;
    if not exists (select 1 from public.ledger_entries where idempotency_key = 'demo:deposit:' || d.slug)
       and not exists (select 1 from public.month_closes where ym >= d.ym) then
      insert into public.ledger_entries (user_id, holding_id, type, amount, ym, ref_type, idempotency_key, meta)
      values (v_uid, v_h, 'deposit', d.amt, d.ym, 'demo_seed', 'demo:deposit:' || d.slug,
              jsonb_build_object('demo', true, 'day', d.day));
    end if;
  end loop;

  for m in select generate_series(date '2026-07-01', date '2026-09-01', interval '1 month')::date loop
    if not exists (select 1 from public.month_closes where ym >= m) then
      perform public.close_month(m);
    end if;
  end loop;
end $$;
