begin;

create table public.snap_balance_snapshots (
  id text primary key,
  benefit_month date not null unique check (extract(day from benefit_month) = 1),
  balance_cents bigint not null check (balance_cents between 0 and 100000000),
  observed_at timestamptz not null,
  source text not null default 'muse' check (source = 'muse'),
  created_at timestamptz not null default now()
);
alter table public.snap_balance_snapshots enable row level security;
create policy snap_balance_member_read on public.snap_balance_snapshots
  for select to authenticated using (public.is_member());
revoke all on public.snap_balance_snapshots from anon, authenticated;
grant select on public.snap_balance_snapshots to authenticated;
grant select, insert, update on public.snap_balance_snapshots to service_role;

create table public.snap_api_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (length(token_hash) = 64),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
alter table public.snap_api_tokens enable row level security;
revoke all on public.snap_api_tokens from public, anon, authenticated;
grant select, insert, update on public.snap_api_tokens to service_role;

create function public.server_rotate_snap_api_token(next_hash text) returns uuid
language plpgsql security definer set search_path='' as $$
declare token_id uuid;
begin
  if length(next_hash) <> 64 or next_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid token hash';
  end if;
  update public.snap_api_tokens set revoked_at=now() where revoked_at is null;
  insert into public.snap_api_tokens(token_hash) values(next_hash) returning id into token_id;
  return token_id;
end $$;
revoke all on function public.server_rotate_snap_api_token(text) from public, anon, authenticated;
grant execute on function public.server_rotate_snap_api_token(text) to service_role;

create function public.server_save_snap_balance(month_start date, amount bigint, seen_at timestamptz) returns boolean
language plpgsql security definer set search_path='' as $$
declare changed integer;
begin
  if extract(day from month_start) <> 1 or amount < 0 or amount > 100000000 then
    raise exception 'Invalid SNAP balance';
  end if;
  insert into public.snap_balance_snapshots(id,benefit_month,balance_cents,observed_at,source)
  values(to_char(month_start,'YYYY-MM'),month_start,amount,seen_at,'muse')
  on conflict(benefit_month) do update
  set balance_cents=excluded.balance_cents,observed_at=excluded.observed_at,source='muse'
  where public.snap_balance_snapshots.observed_at <= excluded.observed_at;
  get diagnostics changed = row_count;
  return changed > 0;
end $$;
revoke all on function public.server_save_snap_balance(date,bigint,timestamptz) from public, anon, authenticated;
grant execute on function public.server_save_snap_balance(date,bigint,timestamptz) to service_role;

commit;
