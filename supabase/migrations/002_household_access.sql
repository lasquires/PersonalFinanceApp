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

commit;
