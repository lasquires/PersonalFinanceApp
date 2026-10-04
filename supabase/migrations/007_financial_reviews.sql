begin;

create table public.review_courier_tokens (
 id uuid primary key default gen_random_uuid(), token_hash text not null unique check(token_hash ~ '^[0-9a-f]{64}$'),
 created_at timestamptz not null default now(), revoked_at timestamptz, last_used_at timestamptz
);
create table public.review_snapshots (
 id uuid primary key, kind text not null check(kind in ('weekly','monthly')), period_start date not null, period_end date not null,
 generated_at timestamptz not null, content_hash text not null check(content_hash ~ '^[0-9a-f]{64}$'), coverage jsonb not null,
 created_at timestamptz not null default now()
);
create table public.review_rate_limits (
 identity_key text not null, hour_start timestamptz not null, operation text not null check(operation in ('export','delivery')),
 attempts integer not null default 0, primary key(identity_key,hour_start,operation)
);
create table public.financial_reviews (
 id uuid primary key default gen_random_uuid(), report_key text not null, revision integer not null check(revision>0),
 snapshot_id uuid not null references public.review_snapshots(id), kind text not null check(kind in ('weekly','monthly')),
 period_start date not null, period_end date not null, title text not null check(length(title) between 1 and 120),
 overview text not null check(length(overview) between 1 and 2000), generated_at timestamptz not null,
 snapshot_generated_at timestamptz not null, saved_at timestamptz not null default now(), warnings text[] not null,
 packet jsonb not null, content_hash text not null check(content_hash ~ '^[0-9a-f]{64}$'), unique(report_key,revision)
);
create table public.review_task_keys (
 task_key text primary key, task_id text references public.tasks(id) on delete set null
);
create table public.financial_review_task_links (
 report_id uuid not null references public.financial_reviews(id), task_key text not null,
 task_id text references public.tasks(id) on delete set null, outcome text not null,
 primary key(report_id,task_key)
);
create table public.review_delivery_receipts (
 id uuid primary key default gen_random_uuid(), report_id uuid not null unique references public.financial_reviews(id),
 receipt jsonb not null, saved_at timestamptz not null default now()
);

do $$ declare t text; begin
 foreach t in array array['review_courier_tokens','review_snapshots','review_rate_limits','financial_reviews','review_task_keys','financial_review_task_links','review_delivery_receipts'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select,insert,update,delete on public.%I to service_role',t);
 end loop;
 foreach t in array array['financial_reviews','financial_review_task_links'] loop
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy member_review_read on public.%I for select to authenticated using(public.is_member())',t);
 end loop;
end $$;

create function public.server_review_identity(member_id uuid,courier_hash text) returns text
language plpgsql security definer set search_path='' as $$
begin
 if member_id is not null and courier_hash is null then
  if not exists(select 1 from public.members where id=member_id and role in ('admin','member')) then raise exception 'Household write access required'; end if;
  return 'member:'||member_id::text;
 elsif member_id is null and courier_hash is not null then
  if not exists(select 1 from public.review_courier_tokens where token_hash=courier_hash and revoked_at is null) then raise exception 'Unauthorized'; end if;
  return 'courier:'||courier_hash;
 end if;
 raise exception 'Unauthorized';
end $$;

create function public.server_rotate_review_token(next_hash text) returns uuid
language plpgsql security definer set search_path='' as $$
declare token_id uuid;
begin
 perform pg_catalog.pg_advisory_xact_lock(62804902);
 if next_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid token hash'; end if;
 update public.review_courier_tokens set revoked_at=now() where revoked_at is null;
 insert into public.review_courier_tokens(token_hash) values(next_hash) returning id into token_id;
 return token_id;
end $$;
create function public.server_revoke_review_token() returns void
language plpgsql security definer set search_path='' as $$ begin
 perform pg_catalog.pg_advisory_xact_lock(62804902);
 update public.review_courier_tokens set revoked_at=now() where revoked_at is null;
end $$;
create function public.server_reserve_review_request(member_id uuid,courier_hash text,request_operation text) returns void
language plpgsql security definer set search_path='' as $$
declare ident text; n integer; max_attempts integer;
begin
 perform pg_catalog.pg_advisory_xact_lock(62804902);
 ident:=public.server_review_identity(member_id,courier_hash);
 if request_operation not in ('export','delivery') then raise exception 'Invalid operation'; end if;
 max_attempts:=case when request_operation='export' then 30 else 60 end;
 insert into public.review_rate_limits(identity_key,hour_start,operation,attempts)
 values(ident,date_trunc('hour',now() at time zone 'UTC') at time zone 'UTC',request_operation,1)
 on conflict(identity_key,hour_start,operation) do update set attempts=public.review_rate_limits.attempts+1
 returning attempts into n;
 if n>max_attempts then raise exception 'Review rate limit exceeded'; end if;
 delete from public.review_rate_limits where hour_start<now()-interval '48 hours';
end $$;
create function public.server_record_review_snapshot(snapshot_id uuid,review_kind text,start_date date,end_date date,exported_at timestamptz,snapshot_hash text,snapshot_coverage jsonb,member_id uuid,courier_hash text) returns void
language plpgsql security definer set search_path='' as $$ begin
 perform pg_catalog.pg_advisory_xact_lock(62804902);
 perform public.server_review_identity(member_id,courier_hash);
 insert into public.review_snapshots(id,kind,period_start,period_end,generated_at,content_hash,coverage)
 values(snapshot_id,review_kind,start_date,end_date,exported_at,snapshot_hash,snapshot_coverage);
 update public.review_courier_tokens set last_used_at=now() where token_hash=courier_hash and revoked_at is null;
end $$;

-- Serialize member task mutations with deliveries, without rewriting household_action.
create function public.lock_review_tasks() returns trigger language plpgsql set search_path='' as $$ begin
 perform pg_catalog.pg_advisory_xact_lock(62804902);
 if TG_OP='DELETE' then return old; end if; return new;
end $$;
create trigger serialize_review_tasks before insert or update or delete on public.tasks for each statement execute function public.lock_review_tasks();

create function public.server_save_financial_review(review_packet jsonb,packet_hash text,member_id uuid,courier_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare snap public.review_snapshots; old_report public.financial_reviews; new_report uuid; delivery uuid:=gen_random_uuid();
 max_revision integer; task jsonb; linked_id text; old_task public.tasks; key_exists boolean;
 created_count integer:=0; linked_count integer:=0; warn text[]:=array[]::text[]; outcome text; result jsonb;
begin
 perform pg_catalog.pg_advisory_xact_lock(62804902);
 perform public.server_review_identity(member_id,courier_hash);
 if packet_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid content hash'; end if;
 select * into snap from public.review_snapshots where id=(review_packet->>'snapshot_id')::uuid;
 if not found then raise exception 'Unknown snapshot'; end if;
 if snap.kind<>review_packet->>'kind' or snap.period_start<>(review_packet->>'period_start')::date or snap.period_end<>(review_packet->>'period_end')::date
 or review_packet->>'report_key'<>snap.kind||':'||snap.period_start::text then raise exception 'Snapshot period mismatch'; end if;
 if (review_packet->>'generated_at')::timestamptz<snap.generated_at or (review_packet->>'generated_at')::timestamptz>now()+interval '5 minutes' then raise exception 'Invalid report generation time'; end if;
 select * into old_report from public.financial_reviews where report_key=review_packet->>'report_key' and revision=(review_packet->>'revision')::integer;
 if found then
  if old_report.content_hash<>packet_hash then raise exception 'Report content conflict'; end if;
  select receipt into result from public.review_delivery_receipts where report_id=old_report.id;
  return result||jsonb_build_object('replayed',true);
 end if;
 select coalesce(max(revision),0) into max_revision from public.financial_reviews where report_key=review_packet->>'report_key';
 if (review_packet->>'revision')::integer<>max_revision+1 then raise exception 'Expected revision %',max_revision+1; end if;
 select coalesce(array_agg(value),array[]::text[]) into warn from jsonb_array_elements_text(coalesce(snap.coverage->'warnings','[]'));
 if now()-snap.generated_at>interval '7 days' then warn:=array_append(warn,'This report uses a snapshot more than seven days old.'); end if;
 insert into public.financial_reviews(report_key,revision,snapshot_id,kind,period_start,period_end,title,overview,generated_at,snapshot_generated_at,warnings,packet,content_hash)
 values(review_packet->>'report_key',(review_packet->>'revision')::integer,snap.id,snap.kind,snap.period_start,snap.period_end,review_packet->>'title',review_packet->>'overview',(review_packet->>'generated_at')::timestamptz,snap.generated_at,warn,review_packet,packet_hash) returning id into new_report;
 perform set_config('app.origin','assistant',true);
 perform set_config('app.tool_name','deliver_financial_review',true);
 for task in select value from jsonb_array_elements(coalesce(review_packet->'tasks','[]')) loop
  if nullif(task->>'category_id','') is not null and not exists(select 1 from public.categories where id=task->>'category_id') then raise exception 'Invalid task category'; end if;
  if nullif(task->>'event_id','') is not null and not exists(select 1 from public.financial_events where id=task->>'event_id') then raise exception 'Invalid task event'; end if;
  linked_id:=null; outcome:='linked';
  select task_id into linked_id from public.review_task_keys where task_key=task->>'task_key'; key_exists:=found;
  if key_exists and linked_id is null then
   outcome:='deleted';warn:=array_append(warn,'Previously deleted task not recreated: '||(task->>'title'));
  elsif not key_exists then
   if nullif(task->>'existing_task_id','') is not null then
    select id into linked_id from public.tasks where id=task->>'existing_task_id';
    if not found then raise exception 'Invalid existing task reference'; end if;
   else
    select * into old_task from public.tasks where lower(regexp_replace(trim(title),'\s+',' ','g'))=lower(regexp_replace(trim(task->>'title'),'\s+',' ','g')) and assignee=task->>'assignee'
    order by case when status in ('Active','Suggested','Waiting') then 0 else 1 end,id limit 1;
    if found then
     if old_task.status in ('Done','Dismissed') then outcome:='terminal';warn:=array_append(warn,'Equivalent completed or dismissed task not reopened: '||(task->>'title'));
     else linked_id:=old_task.id; end if;
    else
     insert into public.tasks(title,status,priority,assignee,due_date,impact_cents,impact_type,notes,suggestion_key,category_id,event_id)
     values(task->>'title','Suggested',task->>'priority',task->>'assignee',nullif(task->>'due_date','')::date,(task->>'impact_cents')::bigint,task->>'impact_type',
     (case when task->>'basis'='agreed' then 'Agreed in discussion. ' else 'New suggestion. ' end)||coalesce(task->>'notes',''),'review:'||(task->>'task_key'),nullif(task->>'category_id',''),nullif(task->>'event_id','')) returning id into linked_id;
     outcome:='created';created_count:=created_count+1;
    end if;
   end if;
   insert into public.review_task_keys(task_key,task_id) values(task->>'task_key',linked_id);
  end if;
  if linked_id is not null and outcome<>'created' then linked_count:=linked_count+1; end if;
  insert into public.financial_review_task_links(report_id,task_key,task_id,outcome) values(new_report,task->>'task_key',linked_id,outcome);
 end loop;
 update public.financial_reviews set warnings=warn where id=new_report;
 result:=jsonb_build_object('delivery_id',delivery,'report_id',new_report,'report_key',review_packet->>'report_key','revision',(review_packet->>'revision')::integer,'saved_at',now(),'replayed',false,'tasks_created',created_count,'tasks_linked',linked_count,'warnings',to_jsonb(warn),'report_url','/?review='||new_report::text);
 insert into public.review_delivery_receipts(id,report_id,receipt) values(delivery,new_report,result);
 update public.review_courier_tokens set last_used_at=now() where token_hash=courier_hash and revoked_at is null;
 return result;
end $$;

revoke all on function public.server_review_identity(uuid,text),public.server_rotate_review_token(text),public.server_revoke_review_token(),public.server_reserve_review_request(uuid,text,text),public.server_record_review_snapshot(uuid,text,date,date,timestamptz,text,jsonb,uuid,text),public.server_save_financial_review(jsonb,text,uuid,text) from public,anon,authenticated;
grant execute on function public.server_review_identity(uuid,text),public.server_rotate_review_token(text),public.server_revoke_review_token(),public.server_reserve_review_request(uuid,text,text),public.server_record_review_snapshot(uuid,text,date,date,timestamptz,text,jsonb,uuid,text),public.server_save_financial_review(jsonb,text,uuid,text) to service_role;
revoke all on function public.lock_review_tasks() from public,anon,authenticated;

alter table public.dashboard_preferences drop constraint known_dashboard_sections;
alter table public.dashboard_preferences add constraint known_dashboard_sections check(cardinality(sections)<=9 and array_position(sections,null) is null and sections<@array['spending','accounts','reserve','snap','tasks','tips','upcoming','activity','reviews']::text[]);
alter table public.dashboard_preferences alter column sections set default array['spending','accounts','reserve','snap','tasks','tips','upcoming','activity','reviews'];
alter publication supabase_realtime add table public.financial_reviews;
commit;
