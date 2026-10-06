begin;

create table public.snap_public_observations (
  id text primary key,
  benefit_month date not null check (extract(day from benefit_month) = 1),
  balance_cents bigint not null check (balance_cents between 0 and 250000),
  observed_at timestamptz not null,
  flagged boolean not null,
  received_at timestamptz not null default now(),
  unique (benefit_month, flagged)
);
alter table public.snap_public_observations enable row level security;
create policy snap_public_member_read on public.snap_public_observations
  for select to authenticated using (public.is_member());
revoke all on public.snap_public_observations from public, anon, authenticated;
grant select on public.snap_public_observations to authenticated;
grant select, insert, update, delete on public.snap_public_observations to service_role;

create table public.snap_public_rate_limits (
  client_hash text not null check (client_hash ~ '^[0-9a-f]{64}$'),
  window_start timestamptz not null,
  window_seconds integer not null check (window_seconds in (60, 3600)),
  hits integer not null check (hits > 0),
  primary key (client_hash, window_start, window_seconds)
);
alter table public.snap_public_rate_limits enable row level security;
revoke all on public.snap_public_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on public.snap_public_rate_limits to service_role;

create function public.server_receive_public_snap(month_start date, amount bigint, seen_at timestamptz, client_hash text)
returns text language plpgsql security definer set search_path='' as $$
declare
  rate_count integer;
  latest_cents bigint;
  latest_seen timestamptz;
  changed integer;
begin
  if month_start is null or extract(day from month_start) <> 1 or amount is null or amount < 0 or amount > 250000
     or seen_at is null or client_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid SNAP observation';
  end if;

  insert into public.snap_public_rate_limits(client_hash, window_start, window_seconds, hits)
  values(client_hash, date_trunc('minute', now()), 60, 1)
  on conflict on constraint snap_public_rate_limits_pkey do update
    set hits = public.snap_public_rate_limits.hits + 1
    where public.snap_public_rate_limits.hits < 10
  returning hits into rate_count;
  if rate_count is null then return 'rate_limited'; end if;

  rate_count := null;
  insert into public.snap_public_rate_limits(client_hash, window_start, window_seconds, hits)
  values(client_hash, date_trunc('hour', now()), 3600, 1)
  on conflict on constraint snap_public_rate_limits_pkey do update
    set hits = public.snap_public_rate_limits.hits + 1
    where public.snap_public_rate_limits.hits < 100
  returning hits into rate_count;
  if rate_count is null then return 'rate_limited'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('snap-public:' || month_start::text));
  select balance_cents, observed_at into latest_cents, latest_seen
  from (
    select balance_cents, observed_at from public.snap_balance_snapshots where benefit_month = month_start
    union all
    select balance_cents, observed_at from public.snap_public_observations where benefit_month = month_start and not flagged
  ) latest order by observed_at desc limit 1;
  if latest_seen is not null and seen_at <= latest_seen then return 'unchanged'; end if;

  if latest_cents is not null and amount - latest_cents > 50000 then
    insert into public.snap_public_observations(id, benefit_month, balance_cents, observed_at, flagged)
    values(to_char(month_start, 'YYYY-MM') || ':flagged', month_start, amount, seen_at, true)
    on conflict (benefit_month, flagged) do update
      set balance_cents = excluded.balance_cents, observed_at = excluded.observed_at, received_at = now()
      where public.snap_public_observations.observed_at < excluded.observed_at;
    return 'flagged';
  end if;

  insert into public.snap_public_observations(id, benefit_month, balance_cents, observed_at, flagged)
  values(to_char(month_start, 'YYYY-MM') || ':accepted', month_start, amount, seen_at, false)
  on conflict (benefit_month, flagged) do update
    set balance_cents = excluded.balance_cents, observed_at = excluded.observed_at, received_at = now()
    where public.snap_public_observations.observed_at < excluded.observed_at;
  get diagnostics changed = row_count;
  delete from public.snap_public_observations
    where benefit_month = month_start and flagged and observed_at <= seen_at;
  return case when changed > 0 then 'updated' else 'unchanged' end;
end $$;
revoke all on function public.server_receive_public_snap(date,bigint,timestamptz,text) from public, anon, authenticated;
grant execute on function public.server_receive_public_snap(date,bigint,timestamptz,text) to service_role;

commit;
