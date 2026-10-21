-- Capital 50 AI — Phase 3: KYC applications, documents (private storage), staff and the review decision.
-- PRODUCTION-BRIEF §3.6, §5.6, §6.2. Safe to re-run.

-- ---------------------------------------------------------------------- staff
do $$ begin
  create type public.staff_role as enum ('owner', 'compliance', 'finance', 'support');
exception when duplicate_object then null; end $$;

create table if not exists public.staff_members (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  role       public.staff_role not null,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists staff_members_updated on public.staff_members;
create trigger staff_members_updated before update on public.staff_members
  for each row execute function public.set_updated_at();

-- Make an existing email login a staff member:  select public.grant_staff('you@example.com', 'owner');
create or replace function public.grant_staff(p_email text, p_role public.staff_role) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid;
begin
  select id into v_uid from auth.users where lower(email) = lower(trim(p_email));
  if v_uid is null then
    raise exception 'No login with email %. Create it first in Authentication > Users > Add user.', p_email;
  end if;
  insert into staff_members (user_id, role, active) values (v_uid, p_role, true)
  on conflict (user_id) do update set role = excluded.role, active = true;
  insert into audit_log (actor_role, action, entity, entity_id, after)
  values ('system', 'staff.grant', 'staff_members', v_uid::text, jsonb_build_object('email', p_email, 'role', p_role));
  return format('%s is now %s staff. They sign in at /admin/login.', p_email, p_role);
end $$;

-- ------------------------------------------------------------- applications
do $$ begin
  create type public.kyc_status as enum ('draft', 'review', 'verified', 'rejected');
exception when duplicate_object then null; end $$;

-- One row per attempt; history is kept. The latest row is the current one.
create table if not exists public.kyc_applications (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete restrict,
  status           public.kyc_status not null default 'draft',
  personal         jsonb not null default '{}'::jsonb,
  financial        jsonb not null default '{}'::jsonb,
  pep              boolean,
  edd              boolean not null default false,
  cnic_hash        text,
  provider_ref     text,
  provider_result  jsonb,
  rejection_reason text,
  submitted_at     timestamptz,
  decided_at       timestamptz,
  decided_by       uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists kyc_applications_user on public.kyc_applications (user_id, created_at desc);
create index if not exists kyc_applications_status on public.kyc_applications (status, submitted_at);
-- One CNIC, one investor: no two people can be under review or verified with the same CNIC.
create unique index if not exists kyc_applications_cnic_once on public.kyc_applications (cnic_hash)
  where status in ('review', 'verified');
-- At most one open (draft or review) application per investor.
create unique index if not exists kyc_applications_one_open on public.kyc_applications (user_id)
  where status in ('draft', 'review');

drop trigger if exists kyc_applications_updated on public.kyc_applications;
create trigger kyc_applications_updated before update on public.kyc_applications
  for each row execute function public.set_updated_at();

do $$ begin
  create type public.kyc_doc_kind as enum ('cnic_front', 'cnic_back', 'selfie');
exception when duplicate_object then null; end $$;

create table if not exists public.kyc_documents (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.kyc_applications(id) on delete restrict,
  user_id        uuid not null references auth.users(id) on delete restrict,
  kind           public.kyc_doc_kind not null,
  storage_path   text not null unique,
  mime           text not null,
  size_bytes     int not null,
  sha256         text not null,
  created_at     timestamptz not null default now()
);
create index if not exists kyc_documents_app on public.kyc_documents (application_id, kind, created_at desc);

-- Private bucket. Only the server (service role) reads or writes it; staff get 5-minute signed links.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('kyc', 'kyc', false, 5242880, array['image/jpeg', 'image/png', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg', 'image/png', 'application/pdf'];

-- ------------------------------------------------------------- the decision
-- Approve or reject an application under review. Only active owner/compliance staff.
-- Approval copies the CNIC name and city onto the profile (the name is locked from then on).
create or replace function public.kyc_decide(p_application uuid, p_staff uuid, p_approve boolean, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_app   kyc_applications%rowtype;
  v_role  staff_role;
  v_after jsonb;
begin
  select role into v_role from staff_members where user_id = p_staff and active;
  if v_role is null or v_role not in ('owner', 'compliance') then
    raise exception 'Only owner or compliance staff can decide KYC';
  end if;

  select * into v_app from kyc_applications where id = p_application for update;
  if not found then raise exception 'Application not found'; end if;
  if v_app.status <> 'review' then
    raise exception 'Application is %, not under review', v_app.status;
  end if;
  if not p_approve and length(trim(coalesce(p_reason, ''))) < 5 then
    raise exception 'A rejection needs a reason the investor can act on';
  end if;
  if p_approve and v_app.user_id = p_staff then
    raise exception 'Staff cannot approve their own application';
  end if;

  update kyc_applications
     set status = case when p_approve then 'verified' else 'rejected' end::kyc_status,
         rejection_reason = case when p_approve then null else trim(p_reason) end,
         decided_at = now(), decided_by = p_staff
   where id = p_application;

  if p_approve then
    update profiles set full_name = v_app.personal->>'fullName', city = v_app.personal->>'city'
     where user_id = v_app.user_id;
  end if;

  v_after := jsonb_build_object('status', case when p_approve then 'verified' else 'rejected' end,
                                'reason', case when p_approve then null else trim(p_reason) end,
                                'pep', v_app.pep);
  insert into audit_log (actor_id, actor_role, action, entity, entity_id, before, after, reason)
  values (p_staff, v_role::text, case when p_approve then 'kyc.approve' else 'kyc.reject' end,
          'kyc_applications', p_application::text, jsonb_build_object('status', v_app.status), v_after,
          nullif(trim(coalesce(p_reason, '')), ''));
  return v_after;
end $$;

-- ---------------------------------------------------------------------- RLS
alter table public.staff_members    enable row level security;
alter table public.kyc_applications enable row level security;
alter table public.kyc_documents    enable row level security;

drop policy if exists kyc_own_read on public.kyc_applications;
create policy kyc_own_read on public.kyc_applications
  for select to authenticated using (user_id = auth.uid());
drop policy if exists kyc_docs_own_read on public.kyc_documents;
create policy kyc_docs_own_read on public.kyc_documents
  for select to authenticated using (user_id = auth.uid());

revoke all on public.staff_members from anon, authenticated;
revoke insert, update, delete on public.kyc_applications, public.kyc_documents from anon, authenticated;
revoke execute on function public.kyc_decide(uuid, uuid, boolean, text) from public, anon, authenticated;
revoke execute on function public.grant_staff(text, public.staff_role) from public, anon, authenticated;
grant execute on function public.kyc_decide(uuid, uuid, boolean, text) to service_role;
