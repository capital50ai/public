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
