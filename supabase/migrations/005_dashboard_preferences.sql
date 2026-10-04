begin;
create table public.dashboard_preferences (
  user_id uuid primary key references public.members(id) on delete cascade,
  sections text[] not null default array['spending','accounts','reserve','snap','tasks','tips','upcoming','activity'],
  account_ids text[],
  category_ids text[],
  updated_at timestamptz not null default now(),
  constraint known_dashboard_sections check (
    cardinality(sections) <= 8 and array_position(sections, null) is null and
    sections <@ array['spending','accounts','reserve','snap','tasks','tips','upcoming','activity']::text[]
  ),
  constraint dashboard_account_selection check (account_ids is null or (cardinality(account_ids) <= 1000 and array_position(account_ids, null) is null)),
  constraint dashboard_category_selection check (category_ids is null or (cardinality(category_ids) <= 1000 and array_position(category_ids, null) is null))
);
alter table public.dashboard_preferences enable row level security;
revoke all on public.dashboard_preferences from public, anon, authenticated;
grant select, insert, update on public.dashboard_preferences to authenticated;
create policy own_dashboard_read on public.dashboard_preferences for select to authenticated
  using (user_id = auth.uid() and public.is_member());
create policy own_dashboard_insert on public.dashboard_preferences for insert to authenticated
  with check (user_id = auth.uid() and public.is_member());
create policy own_dashboard_update on public.dashboard_preferences for update to authenticated
  using (user_id = auth.uid() and public.is_member())
  with check (user_id = auth.uid() and public.is_member());
commit;
