-- Phase 3 checks: KYC decision rules, CNIC uniqueness, one open application, staff roles, RLS.
\set ON_ERROR_STOP on
begin;
insert into auth.users (id, phone, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', '923000000201', null, '{"full_name":"Investor One"}'),
  ('00000000-0000-0000-0000-0000000000a2', '923000000202', null, '{"full_name":"Investor Two"}'),
  ('00000000-0000-0000-0000-0000000000f1', null, 'owner@c50.test', '{}'),
  ('00000000-0000-0000-0000-0000000000f2', null, 'support@c50.test', '{}');
select public.grant_staff('OWNER@c50.test', 'owner');
select public.grant_staff('support@c50.test', 'support');

insert into public.kyc_applications (id, user_id, status, personal, pep, cnic_hash, submitted_at) values
  ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000a1', 'review',
   '{"fullName":"Ali Raza Khan","city":"Lahore"}', false, 'hash-1', now());

do $$ declare r jsonb; n int; begin
  -- support staff can't decide; nobody can reject without a reason
  begin perform public.kyc_decide('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000f2', true, null);
        raise exception 'support decided';
  exception when raise_exception then if sqlerrm = 'support decided' then raise; end if; end;
  begin perform public.kyc_decide('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000f1', false, 'no');
        raise exception 'reject without reason';
  exception when raise_exception then if sqlerrm = 'reject without reason' then raise; end if; end;

  r := public.kyc_decide('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000f1', true, null);
  assert r->>'status' = 'verified', 'approve ' || r;
  select count(*) into n from public.profiles where user_id = '00000000-0000-0000-0000-0000000000a1'
    and full_name = 'Ali Raza Khan' and city = 'Lahore'; assert n = 1, 'profile name not locked to CNIC name';
  select count(*) into n from public.audit_log where action = 'kyc.approve'; assert n = 1, 'approve not audited';
  -- a decided application can't be decided again
  begin perform public.kyc_decide('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000f1', false, 'changed my mind');
        raise exception 'decided twice';
  exception when raise_exception then if sqlerrm = 'decided twice' then raise; end if; end;
end $$;

-- the same CNIC can't be under review for a second person
do $$ begin
  insert into public.kyc_applications (user_id, status, cnic_hash, submitted_at)
  values ('00000000-0000-0000-0000-0000000000a2', 'review', 'hash-1', now());
  raise exception 'duplicate CNIC accepted';
exception when unique_violation then null; end $$;

-- one open application per investor; a rejected one can be followed by a new draft
do $$ declare r jsonb; begin
  insert into public.kyc_applications (id, user_id, status, cnic_hash, submitted_at)
  values ('00000000-0000-0000-0000-00000000c002', '00000000-0000-0000-0000-0000000000a2', 'review', 'hash-2', now());
  begin insert into public.kyc_applications (user_id) values ('00000000-0000-0000-0000-0000000000a2');
        raise exception 'second open application';
  exception when unique_violation then null; end;
  r := public.kyc_decide('00000000-0000-0000-0000-00000000c002', '00000000-0000-0000-0000-0000000000f1', false, 'CNIC photo is blurred');
  assert r->>'status' = 'rejected', 'reject ' || r;
  insert into public.kyc_applications (user_id) values ('00000000-0000-0000-0000-0000000000a2');
end $$;

-- RLS: investor sees only their own applications; no writes; no staff table
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
do $$ declare n int; begin
  select count(*) into n from public.kyc_applications; assert n = 2, 'sees ' || n || ' applications';
  begin update public.kyc_applications set status = 'verified'; raise exception 'self-verify';
  exception when insufficient_privilege then null; end;
  begin select count(*) into n from public.staff_members; raise exception 'staff table readable';
  exception when insufficient_privilege then null; end;
  begin perform public.kyc_decide('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000f1', true, null);
        raise exception 'kyc_decide callable';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
\echo PHASE 3 KYC TESTS PASSED
