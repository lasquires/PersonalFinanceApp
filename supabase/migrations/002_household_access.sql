begin;

create type public.member_role as enum ('admin','member','viewer');

alter table public.members drop constraint members_name_check;
alter table public.members drop constraint members_name_key;
alter table public.members add constraint members_name_length check(length(trim(name)) between 1 and 100);
alter table public.members add column email text;
alter table public.members add column role public.member_role not null default 'viewer';
update public.members set role='admin' where name in ('Luke','Samantha');
create unique index members_email_unique on public.members(lower(email)) where email is not null;

create function public.current_member_role() returns public.member_role
language sql stable security definer set search_path=''
as $$ select role from public.members where id=auth.uid() $$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path=''
as $$ select coalesce(public.current_member_role()='admin',false) $$;

create function public.can_write_household() returns boolean
language sql stable security definer set search_path=''
as $$ select coalesce(public.current_member_role() in ('admin','member'),false) $$;

revoke all on function public.current_member_role(),public.is_admin(),public.can_write_household() from public;
grant execute on function public.current_member_role(),public.is_admin(),public.can_write_household() to authenticated;

create function private.require_remaining_admin() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='DELETE' and old.role='admin' then
    perform 1 from public.members where role='admin' order by id for update;
    if (select count(*) from public.members where role='admin' and id<>old.id)=0 then
      raise exception 'Household must retain an admin';
    end if;
  elsif tg_op='UPDATE' and old.role='admin' and new.role<>'admin' then
    perform 1 from public.members where role='admin' order by id for update;
    if (select count(*) from public.members where role='admin' and id<>old.id)=0 then
      raise exception 'Household must retain an admin';
    end if;
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;

create trigger retain_admin before update of role or delete on public.members
for each row execute function private.require_remaining_admin();

alter function public.household_action(text,jsonb,text) rename to household_action_unchecked;
revoke all on function public.household_action_unchecked(text,jsonb,text) from public,anon,authenticated;

create function public.household_action(action text, payload jsonb, origin text default 'member')
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.can_write_household() then
    raise exception 'Household write access required' using errcode='42501';
  end if;
  if origin<>'member' then raise exception 'Invalid origin'; end if;
  perform public.household_action_unchecked(action,payload,'member');
end $$;

revoke all on function public.household_action(text,jsonb,text) from public,anon;
grant execute on function public.household_action(text,jsonb,text) to authenticated;

create table public.household_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null check(email=lower(trim(email))),
  role public.member_role not null default 'viewer',
  status text not null default 'pending' check(status in ('pending','accepted','revoked','error')),
  token_hash text not null unique check(length(token_hash)=64),
  invited_by uuid not null references public.members(id),
  expires_at timestamptz not null,
  accepted_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index one_pending_invitation_per_email on public.household_invitations(email) where status='pending';
alter table public.household_invitations enable row level security;
create policy invitations_admin_read on public.household_invitations for select to authenticated using(public.is_admin());
revoke all on public.household_invitations from anon,authenticated;
grant select on public.household_invitations to authenticated;
grant select,insert,update,delete on public.household_invitations to service_role;

create table public.tips (
  id uuid primary key default gen_random_uuid(),
  title text not null check(length(title) between 1 and 120),
  body text not null check(length(body) between 1 and 800),
  evidence jsonb not null default '{}' check(jsonb_typeof(evidence)='object'),
  status text not null default 'active' check(status in ('active','archived','dismissed')),
  expires_at date,
  created_by uuid references public.members(id),
  origin text not null default 'member' check(origin in ('member','assistant')),
  oauth_client_id text,
  tool_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.tips enable row level security;
create policy tips_member_read on public.tips for select to authenticated using(public.is_member());
revoke all on public.tips from anon,authenticated;
grant select on public.tips to authenticated;
grant select,insert,update on public.tips to service_role;
create trigger tips_audit after insert or update or delete on public.tips for each row execute function private.audit_change();

create function public.set_tip_status(tip_id uuid, next_status text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not public.can_write_household() then raise exception 'Household write access required' using errcode='42501'; end if;
  if next_status not in ('archived','dismissed') then raise exception 'Invalid tip status'; end if;
  perform set_config('app.origin','member',true);
  update public.tips set status=next_status,updated_at=now() where id=tip_id;
end $$;
revoke all on function public.set_tip_status(uuid,text) from public,anon;
grant execute on function public.set_tip_status(uuid,text) to authenticated;

create function public.server_accept_invitation(user_id uuid, supplied_email text, supplied_hash text) returns boolean
language plpgsql security definer set search_path='' as $$
declare invite public.household_invitations; normalized text:=lower(trim(supplied_email));
begin
  select * into invite from public.household_invitations
  where email=normalized and token_hash=supplied_hash and status='pending' and expires_at>now() for update;
  if not found then return false; end if;
  insert into public.members(id,name,email,role)
  values(user_id,left(initcap(split_part(normalized,'@',1)),100),normalized,invite.role)
  on conflict(id) do update set email=excluded.email,role=excluded.role;
  update public.household_invitations set status='accepted',accepted_by=user_id,updated_at=now() where id=invite.id;
  return true;
end $$;

create function public.server_set_member_role(actor_id uuid, member_id uuid, next_role public.member_role) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.members where id=actor_id and role='admin') then raise exception 'Administrator access required'; end if;
  update public.members set role=next_role where id=member_id;
end $$;

create function public.server_remove_member(actor_id uuid, member_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.members where id=actor_id and role='admin') then raise exception 'Administrator access required'; end if;
  delete from public.members where id=member_id;
end $$;

revoke all on function public.server_accept_invitation(uuid,text,text),public.server_set_member_role(uuid,uuid,public.member_role),public.server_remove_member(uuid,uuid) from public,anon,authenticated;
grant execute on function public.server_accept_invitation(uuid,text,text),public.server_set_member_role(uuid,uuid,public.member_role),public.server_remove_member(uuid,uuid) to service_role;

do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    alter publication supabase_realtime add table public.tips;
  end if;
end $$;

commit;
