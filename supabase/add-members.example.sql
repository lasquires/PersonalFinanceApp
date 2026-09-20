-- Run only after creating both users in Supabase Authentication > Users.
-- Replace the placeholders before running. The migration restricts names to Luke and Samantha.
begin;

insert into public.members(id, name)
select id, 'Luke' from auth.users where email = 'LUKE_EMAIL_HERE'
on conflict (id) do update set name = excluded.name;

insert into public.members(id, name)
select id, 'Samantha' from auth.users where email = 'SAMANTHA_EMAIL_HERE'
on conflict (id) do update set name = excluded.name;

do $$
begin
  if (select count(*) from public.members) <> 2 then
    raise exception 'Expected exactly two household members. Check both email addresses.';
  end if;
end $$;

commit;
