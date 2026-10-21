begin;

alter table public.snap_balance_snapshots drop constraint snap_balance_snapshots_source_check;
alter table public.snap_balance_snapshots add constraint snap_balance_snapshots_source_check
  check (source in ('muse','household'));

create table public.snap_refill_acceptances (
  benefit_month date primary key check (extract(day from benefit_month)=1),
  previous_cents bigint not null,
  accepted_cents bigint not null,
  observed_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.snap_refill_acceptances enable row level security;
revoke all on public.snap_refill_acceptances from public,anon,authenticated;

alter function public.server_receive_public_snap(date,bigint,timestamptz,text)
  rename to server_receive_public_snap_before_refill;
revoke all on function public.server_receive_public_snap_before_refill(date,bigint,timestamptz,text)
  from public,anon,authenticated,service_role;
create function public.server_receive_public_snap(month_start date,amount bigint,seen_at timestamptz,client_hash text)
returns text language plpgsql security definer set search_path='' as $$
declare outcome text; latest_cents bigint; report public.snap_public_observations;
begin
  outcome:=public.server_receive_public_snap_before_refill(month_start,amount,seen_at,client_hash);
  if outcome<>'flagged' then return outcome; end if;
  select balance_cents into latest_cents from (
    select balance_cents,observed_at from public.snap_balance_snapshots where benefit_month=month_start
    union all
    select balance_cents,observed_at from public.snap_public_observations where benefit_month=month_start and not flagged
  ) accepted order by observed_at desc limit 1;
  select * into report from public.snap_public_observations
  where benefit_month=month_start and flagged and balance_cents=amount and observed_at=seen_at;
  if not found or latest_cents is null or amount-latest_cents>=100000
    or exists(select 1 from public.snap_refill_acceptances where benefit_month=month_start) then
    return 'flagged';
  end if;
  insert into public.snap_refill_acceptances(benefit_month,previous_cents,accepted_cents,observed_at)
  values(month_start,latest_cents,amount,seen_at);
  insert into public.snap_public_observations(id,benefit_month,balance_cents,observed_at,flagged)
  values(to_char(month_start,'YYYY-MM') || ':accepted',month_start,amount,seen_at,false)
  on conflict(benefit_month,flagged) do update
    set balance_cents=excluded.balance_cents,observed_at=excluded.observed_at,received_at=now();
  delete from public.snap_public_observations where id=report.id;
  return 'updated';
end $$;
revoke all on function public.server_receive_public_snap(date,bigint,timestamptz,text) from public,anon,authenticated;
grant execute on function public.server_receive_public_snap(date,bigint,timestamptz,text) to service_role;

create function public.approve_snap_refill(month_start date, expected_amount bigint, expected_seen_at timestamptz)
returns boolean language plpgsql security definer set search_path='' as $$
declare report public.snap_public_observations; latest_seen timestamptz;
begin
  if not public.is_admin() then
    raise exception 'Household admin access required' using errcode='42501';
  end if;
  if month_start is null or expected_amount is null or expected_seen_at is null then
    raise exception 'Choose a balance to confirm';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('snap-public:' || month_start::text));
  select * into report from public.snap_public_observations
  where benefit_month=month_start and flagged and balance_cents=expected_amount
    and observed_at=expected_seen_at for update;
  if not found then raise exception 'This balance changed. Refresh and review it again'; end if;
  select max(observed_at) into latest_seen from (
    select observed_at from public.snap_balance_snapshots where benefit_month=month_start
    union all
    select observed_at from public.snap_public_observations where benefit_month=month_start and not flagged
  ) accepted;
  if latest_seen is not null and latest_seen>=report.observed_at then
    raise exception 'This balance changed. Refresh and review it again';
  end if;
  insert into public.snap_balance_snapshots(id,benefit_month,balance_cents,observed_at,source)
  values(to_char(month_start,'YYYY-MM'),month_start,report.balance_cents,report.observed_at,'household')
  on conflict(benefit_month) do update set balance_cents=excluded.balance_cents,
    observed_at=excluded.observed_at,source='household';
  delete from public.snap_public_observations where id=report.id;
  insert into public.audit_log(actor,origin,table_name,action,after_data)
  values(auth.uid(),'member','snap_balance_snapshots','APPROVE',
    jsonb_build_object('benefit_month',month_start,'balance_cents',report.balance_cents,'observed_at',report.observed_at));
  return true;
end $$;
revoke all on function public.approve_snap_refill(date,bigint,timestamptz) from public,anon;
grant execute on function public.approve_snap_refill(date,bigint,timestamptz) to authenticated;

do $$ declare report public.snap_public_observations; latest_cents bigint; latest_seen timestamptz; begin
  for report in select * from public.snap_public_observations
    where flagged and benefit_month=date_trunc('month',now() at time zone 'America/New_York')::date loop
    select balance_cents,observed_at into latest_cents,latest_seen from (
      select balance_cents,observed_at from public.snap_balance_snapshots where benefit_month=report.benefit_month
      union all
      select balance_cents,observed_at from public.snap_public_observations where benefit_month=report.benefit_month and not flagged
    ) accepted order by observed_at desc limit 1;
    if latest_cents is not null and report.observed_at>latest_seen
      and report.balance_cents-latest_cents>50000 and report.balance_cents-latest_cents<100000
      and not exists(select 1 from public.snap_refill_acceptances where benefit_month=report.benefit_month) then
      insert into public.snap_refill_acceptances(benefit_month,previous_cents,accepted_cents,observed_at)
      values(report.benefit_month,latest_cents,report.balance_cents,report.observed_at);
      insert into public.snap_public_observations(id,benefit_month,balance_cents,observed_at,flagged)
      values(to_char(report.benefit_month,'YYYY-MM') || ':accepted',report.benefit_month,report.balance_cents,report.observed_at,false)
      on conflict(benefit_month,flagged) do update
        set balance_cents=excluded.balance_cents,observed_at=excluded.observed_at,received_at=now();
      delete from public.snap_public_observations where id=report.id;
    end if;
  end loop;
end $$;

commit;

