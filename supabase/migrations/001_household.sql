begin;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.members (id uuid primary key references auth.users(id) on delete cascade, name text not null check (name in ('Luke','Samantha')), unique(name));
alter table public.members enable row level security;
create function public.is_member() returns boolean language sql stable security definer set search_path = '' as $$ select exists(select 1 from public.members where id = auth.uid()) $$;
revoke all on function public.is_member() from public;
grant execute on function public.is_member() to authenticated;
create policy members_read on public.members for select to authenticated using (public.is_member());

create table public.categories (id text primary key, name text not null check(length(name) between 1 and 100), "group" text not null check ("group" in ('flexible','fixed','business')), monthly_cents bigint not null check(monthly_cents between 0 and 10000000000), rollover boolean not null default false, start_month date not null check(extract(day from start_month)=1), color text not null default '#548a78');
create table public.monthly_limits (category_id text references public.categories(id), month date check(extract(day from month)=1), amount_cents bigint not null check(amount_cents between 0 and 10000000000), primary key(category_id, month));
create table private.plaid_items (id text primary key, access_token text not null, cursor text not null default '', institution text not null, member text not null check(member in ('Luke','Samantha')), created_at timestamptz not null default now(), last_synced_at timestamptz, sync_error text);
create table public.accounts (id text primary key, item_id text references private.plaid_items(id) on delete set null, name text not null, institution text not null, member text not null, mask text not null default '', type text not null, balance_cents bigint, last_synced_at timestamptz, sync_error text);
create table public.transactions (id text primary key, account_id text references public.accounts(id), merchant text not null check(length(merchant) between 1 and 300), date date not null, amount_cents bigint not null check(abs(amount_cents)<=10000000000), category_id text references public.categories(id), kind text not null default 'expense' check(kind in ('expense','transfer','income')), excluded boolean not null default false, pending boolean not null default false, removed boolean not null default false, note text not null default '', splits jsonb not null default '[]', source text not null check(source in ('manual','csv','plaid')), pending_transaction_id text, currency text not null default 'USD', needs_review boolean not null default true, user_modified boolean not null default false);
create index transactions_date on public.transactions(date desc);
create index transactions_account on public.transactions(account_id);
create table public.tasks (id text primary key default gen_random_uuid()::text, title text not null check(length(title) between 1 and 200), status text not null default 'Active' check(status in ('Suggested','Active','Waiting','Done','Dismissed')), priority text not null default 'Normal' check(priority in ('High','Normal','Low')), assignee text not null default 'Together' check(assignee in ('Luke','Samantha','Together')), due_date date, impact_cents bigint not null default 0 check(impact_cents>=0), impact_type text not null default 'once' check(impact_type in ('once','monthly')), notes text not null default '', suggestion_key text unique, category_id text references public.categories(id), event_id text);
create table public.financial_events (id text primary key default gen_random_uuid()::text, name text not null check(length(name) between 1 and 200), date date, amount_cents bigint not null default 0 check(amount_cents between 0 and 10000000000), direction text not null default 'outflow' check(direction in ('outflow','inflow')), certainty text not null default 'Estimated' check(certainty in ('Confirmed','Estimated')), notes text not null default '', affects_runway boolean not null default true, recurring_monthly boolean not null default false, milestone boolean not null default false);
alter table public.tasks add foreign key(event_id) references public.financial_events(id) on delete set null;
create table public.reservoir_entries (id text primary key default gen_random_uuid()::text, date date not null default current_date, amount_cents bigint not null check(abs(amount_cents)<=10000000000), note text not null check(length(note) between 1 and 1000), kind text not null check(kind in ('initial','deposit','withdrawal','correction')), created_at timestamptz not null default now());
create unique index reservoir_one_initial on public.reservoir_entries(kind) where kind='initial';
create table public.settings (id integer primary key check(id=1), floor_cents bigint not null check(floor_cents>=0), annual_irregular_cents bigint not null check(annual_irregular_cents>=0), annual_notes text not null default '', timezone text not null default 'America/New_York' check(timezone='America/New_York'), forecast_months integer not null default 36 check(forecast_months between 24 and 36));
create table public.audit_log (id bigint generated always as identity primary key, created_at timestamptz not null default now(), actor uuid, origin text not null, table_name text not null, action text not null, before_data jsonb, after_data jsonb);

create function private.audit_change() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.audit_log(actor,origin,table_name,action,before_data,after_data) values(auth.uid(),coalesce(nullif(current_setting('app.origin',true),''),'member'),TG_TABLE_NAME,TG_OP,case when TG_OP<>'INSERT' then to_jsonb(old) end,case when TG_OP<>'DELETE' then to_jsonb(new) end);
 return coalesce(new,old);
end $$;
do $$ declare t text; begin
 foreach t in array array['categories','monthly_limits','accounts','transactions','tasks','financial_events','reservoir_entries','settings','audit_log'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('create policy household_read on public.%I for select to authenticated using (public.is_member())',t);
 execute format('revoke all on public.%I from anon, authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 if t not in ('accounts','audit_log') then execute format('create trigger audit after insert or update or delete on public.%I for each row execute function private.audit_change()',t); end if;
 end loop;
end $$;
revoke all on public.members from anon, authenticated;
grant select on public.members to authenticated;

create function private.check_splits() returns trigger language plpgsql set search_path='' as $$
declare s jsonb; total bigint:=0; n integer;
begin
 if jsonb_typeof(new.splits)<>'array' then raise exception 'Splits must be an array'; end if;
 n:=jsonb_array_length(new.splits);
 if n=0 then return new; end if;
 if n<2 or n>30 then raise exception 'Use 2 to 30 splits'; end if;
 for s in select * from jsonb_array_elements(new.splits) loop
 if not exists(select 1 from public.categories where id=s->>'category_id') or (s->>'amount_cents')::numeric<>trunc((s->>'amount_cents')::numeric) or sign((s->>'amount_cents')::bigint)<>sign(new.amount_cents) or (s->>'amount_cents')::bigint=0 then raise exception 'Invalid split'; end if;
 total:=total+(s->>'amount_cents')::bigint;
 end loop;
 if total<>new.amount_cents then raise exception 'Splits must equal transaction total'; end if;
 return new;
end $$;
create trigger validate_splits before insert or update on public.transactions for each row execute function private.check_splits();

create function public.household_action(action text, payload jsonb, origin text default 'member') returns void language plpgsql security definer set search_path='' as $$
declare t public.transactions; r public.tasks; e public.financial_events; s public.settings; c public.categories; v_id text;
begin
 if not public.is_member() then raise exception 'Household access required' using errcode='42501'; end if;
 if origin not in ('member','assistant') then raise exception 'Invalid origin'; end if;
 perform set_config('app.origin',origin,true);
 v_id:=coalesce(payload->>'id',gen_random_uuid()::text);
 case action
 when 'budget' then
   insert into public.monthly_limits(category_id,month,amount_cents) values(payload->>'category_id',(payload->>'month')::date,(payload->>'amount_cents')::bigint) on conflict(category_id,month) do update set amount_cents=excluded.amount_cents;
 when 'category' then
   select * into c from jsonb_populate_record(null::public.categories,payload);
   insert into public.categories values(c.*) on conflict(id) do update set name=excluded.name,"group"=excluded."group",monthly_cents=excluded.monthly_cents,rollover=excluded.rollover,color=excluded.color;
 when 'task' then
   select * into r from jsonb_populate_record(null::public.tasks,payload);
   insert into public.tasks values(v_id,r.title,r.status,r.priority,r.assignee,r.due_date,r.impact_cents,r.impact_type,r.notes,r.suggestion_key,r.category_id,r.event_id)
   on conflict(id) do update set title=excluded.title,status=excluded.status,priority=excluded.priority,assignee=excluded.assignee,due_date=excluded.due_date,impact_cents=excluded.impact_cents,impact_type=excluded.impact_type,notes=excluded.notes,category_id=excluded.category_id,event_id=excluded.event_id;
 when 'event' then
   select * into e from jsonb_populate_record(null::public.financial_events,payload);
   insert into public.financial_events values(v_id,e.name,e.date,e.amount_cents,e.direction,e.certainty,e.notes,e.affects_runway,e.recurring_monthly,e.milestone)
   on conflict(id) do update set name=excluded.name,date=excluded.date,amount_cents=excluded.amount_cents,direction=excluded.direction,certainty=excluded.certainty,notes=excluded.notes,affects_runway=excluded.affects_runway,recurring_monthly=excluded.recurring_monthly,milestone=excluded.milestone;
 when 'delete_event' then delete from public.financial_events where id=v_id;
 when 'reservoir' then
   if (payload->>'date')::date > (now() at time zone 'America/New_York')::date then raise exception 'Future cash belongs in the financial calendar'; end if;
   insert into public.reservoir_entries(id,date,amount_cents,note,kind) values(v_id,(payload->>'date')::date,(payload->>'amount_cents')::bigint,payload->>'note',payload->>'kind');
 when 'settings' then
   select * into s from jsonb_populate_record(null::public.settings,payload);
   update public.settings set floor_cents=s.floor_cents,annual_irregular_cents=s.annual_irregular_cents,annual_notes=s.annual_notes,forecast_months=s.forecast_months where id=1;
 when 'transaction' then
   select * into t from public.transactions where id=v_id for update;
   if found then
     update public.transactions set category_id=payload->>'category_id',kind=payload->>'kind',excluded=(payload->>'excluded')::boolean,note=coalesce(payload->>'note',''),splits=coalesce(payload->'splits','[]'),needs_review=false,user_modified=true where id=v_id;
   else
     if coalesce(payload->>'source','manual') not in ('manual','csv') then raise exception 'Invalid transaction source'; end if;
     insert into public.transactions(id,merchant,date,amount_cents,category_id,kind,excluded,note,splits,source,needs_review,user_modified) values(v_id,payload->>'merchant',(payload->>'date')::date,(payload->>'amount_cents')::bigint,payload->>'category_id',coalesce(payload->>'kind','expense'),coalesce((payload->>'excluded')::boolean,false),coalesce(payload->>'note',''),coalesce(payload->'splits','[]'),coalesce(payload->>'source','manual'),false,true);
   end if;
 when 'delete_transaction' then
   update public.transactions set removed=true where id=v_id and source in ('manual','csv');
 else raise exception 'Unknown action';
 end case;
end $$;
revoke all on function public.household_action(text,jsonb,text) from public;
grant execute on function public.household_action(text,jsonb,text) to authenticated;

-- Tokens never enter a client-visible table or view. Only the server service role can use these RPCs.
create function public.server_items() returns setof private.plaid_items language sql security definer set search_path='' as $$ select * from private.plaid_items $$;
create function public.server_save_item(item text, token text, institution_name text, member_name text, account_rows jsonb) returns void language plpgsql security definer set search_path='' as $$
declare a jsonb;
begin
 insert into private.plaid_items(id,access_token,institution,member) values(item,token,institution_name,member_name) on conflict(id) do update set access_token=excluded.access_token;
 for a in select * from jsonb_array_elements(account_rows) loop
 insert into public.accounts(id,item_id,name,institution,member,mask,type,balance_cents) values(a->>'account_id',item,a->>'name',institution_name,member_name,coalesce(a->>'mask',''),a->>'type',round((a->'balances'->>'current')::numeric*100)::bigint) on conflict(id) do update set name=excluded.name,balance_cents=excluded.balance_cents;
 end loop;
end $$;
create function public.server_sync_error(item text, code text) returns void language plpgsql security definer set search_path='' as $$ begin update private.plaid_items set sync_error=code where id=item; update public.accounts set sync_error=code where item_id=item; end $$;
create function public.server_apply_sync(item text, expected_cursor text, next_cursor text, added jsonb, modified jsonb, removed jsonb, account_rows jsonb) returns boolean language plpgsql security definer set search_path='' as $$
declare current_cursor text; j jsonb; a jsonb; prior public.transactions; existing public.transactions; v_splits jsonb; v_review boolean;
begin
 select cursor into current_cursor from private.plaid_items where id=item for update;
 if not found or current_cursor<>expected_cursor then return false; end if;
 perform set_config('app.origin','plaid',true);
 for j in select * from jsonb_array_elements(added || modified) loop
   if not exists(select 1 from public.accounts where id=j->>'account_id' and item_id=item) then raise exception 'Account is not in item'; end if;
   prior:=null; existing:=null;
   select * into existing from public.transactions where id=j->>'id';
   if j->>'pending_transaction_id' is not null then
     select * into prior from public.transactions where id=j->>'pending_transaction_id' and account_id=j->>'account_id';
   end if;
   if existing.user_modified then prior:=existing; end if;
   v_splits:=case when prior.user_modified and prior.amount_cents=(j->>'amount_cents')::bigint then prior.splits else '[]'::jsonb end;
   v_review:=coalesce((j->>'needs_review')::boolean,true) or (coalesce(prior.user_modified,false) and prior.amount_cents<>(j->>'amount_cents')::bigint and jsonb_array_length(prior.splits)>0);
   insert into public.transactions(id,account_id,merchant,date,amount_cents,category_id,kind,excluded,pending,removed,note,splits,source,pending_transaction_id,currency,needs_review,user_modified)
   values(j->>'id',j->>'account_id',j->>'merchant',(j->>'date')::date,(j->>'amount_cents')::bigint,case when prior.user_modified then prior.category_id else j->>'category_id' end,case when prior.user_modified then prior.kind else j->>'kind' end,coalesce(prior.excluded,false),(j->>'pending')::boolean,false,coalesce(prior.note,''),v_splits,'plaid',j->>'pending_transaction_id',coalesce(j->>'currency','UNKNOWN'),v_review,coalesce(prior.user_modified,false))
   on conflict(id) do update set merchant=excluded.merchant,date=excluded.date,amount_cents=excluded.amount_cents,category_id=excluded.category_id,kind=excluded.kind,excluded=excluded.excluded,pending=excluded.pending,removed=false,note=excluded.note,splits=excluded.splits,currency=excluded.currency,needs_review=excluded.needs_review,user_modified=excluded.user_modified;
   if j->>'pending_transaction_id' is not null then update public.transactions set removed=true where id=j->>'pending_transaction_id' and account_id=j->>'account_id'; end if;
 end loop;
 for j in select * from jsonb_array_elements(removed) loop
   update public.transactions set removed=true where id=j->>'transaction_id' and account_id in(select id from public.accounts where item_id=item);
 end loop;
 for a in select * from jsonb_array_elements(account_rows) loop
   update public.accounts set balance_cents=round((a->'balances'->>'current')::numeric*100)::bigint where id=a->>'account_id' and item_id=item;
 end loop;
 update private.plaid_items set cursor=next_cursor,last_synced_at=now(),sync_error=null where id=item;
 update public.accounts set last_synced_at=now(),sync_error=null where item_id=item;
 return true;
end $$;
revoke all on function public.server_items(),public.server_save_item(text,text,text,text,jsonb),public.server_sync_error(text,text),public.server_apply_sync(text,text,text,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.server_items(),public.server_save_item(text,text,text,text,jsonb),public.server_sync_error(text,text),public.server_apply_sync(text,text,text,jsonb,jsonb,jsonb,jsonb) to service_role;

create view public.assistant_current_reservoir with (security_invoker=true) as select s.floor_cents,coalesce((select sum(amount_cents) from public.reservoir_entries where date<=current_date),0) as balance_cents,s.annual_irregular_cents,s.annual_notes from public.settings s;
create view public.assistant_upcoming_events with (security_invoker=true) as select * from public.financial_events where date between current_date and current_date+90 or date is null;
create view public.assistant_attention with (security_invoker=true) as select * from public.tasks where status in ('Active','Suggested','Waiting');
create view public.assistant_spending with (security_invoker=true) as
 select t.id,t.date,t.merchant,t.pending,coalesce(s->>'category_id',t.category_id,'uncategorized') as category_id,case when s is not null then (s->>'amount_cents')::bigint else t.amount_cents end as amount_cents
 from public.transactions t left join lateral jsonb_array_elements(t.splits) s on true where not t.excluded and not t.removed and t.kind='expense' and t.currency='USD';
create view public.assistant_monthly_budget with (security_invoker=true) as
with month_now as (select date_trunc('month',now() at time zone 'America/New_York')::date as report_month),
spent as (
 select category_id,date_trunc('month',date)::date as spend_month,sum(amount_cents)::bigint amount_cents
 from public.assistant_spending group by category_id,date_trunc('month',date)::date
), category_months as (
 select c.id,c.name,c."group",c.rollover,m.budget_month::date as budget_month,
   coalesce(l.amount_cents,c.monthly_cents)::bigint budget_cents,
   coalesce(s.amount_cents,0)::bigint spent_cents
 from public.categories c
 cross join lateral generate_series(c.start_month,(select report_month from month_now),interval '1 month') as m(budget_month)
 left join public.monthly_limits l on l.category_id=c.id and l.month=m.budget_month
 left join spent s on s.category_id=c.id and s.spend_month=m.budget_month
)
select id as category_id,name,"group",rollover,
 max(budget_cents) filter(where budget_month=(select report_month from month_now))::bigint as budget_cents,
 case when rollover then coalesce(sum(budget_cents-spent_cents) filter(where budget_month<(select report_month from month_now)),0) else 0 end::bigint as carried_cents,
 max(spent_cents) filter(where budget_month=(select report_month from month_now))::bigint as spent_cents,
 (max(budget_cents) filter(where budget_month=(select report_month from month_now)) +
   case when rollover then coalesce(sum(budget_cents-spent_cents) filter(where budget_month<(select report_month from month_now)),0) else 0 end -
   max(spent_cents) filter(where budget_month=(select report_month from month_now)))::bigint as remaining_cents
from category_months group by id,name,"group",rollover;
create view public.assistant_account_health with (security_invoker=true) as
 select id,name,institution,member,mask,type,last_synced_at,sync_error from public.accounts;
create view public.assistant_runway_inputs with (security_invoker=true) as
 select r.balance_cents,r.floor_cents,r.annual_irregular_cents,r.annual_notes,
   (select coalesce(sum(monthly_cents),0)::bigint from public.categories) as default_monthly_budget_cents,
   e.name as next_milestone,e.date as next_milestone_date,e.amount_cents as next_milestone_amount_cents,e.direction as next_milestone_direction
 from public.assistant_current_reservoir r left join lateral (
   select name,date,amount_cents,direction from public.financial_events where milestone and date>=current_date order by date limit 1
 ) e on true;
grant select on public.assistant_current_reservoir,public.assistant_upcoming_events,public.assistant_attention,public.assistant_spending,public.assistant_monthly_budget,public.assistant_account_health,public.assistant_runway_inputs to authenticated;

insert into public.settings(id,floor_cents,annual_irregular_cents,annual_notes) values(1,500000,382000,'Property tax $2,620 + gifts $600 + car maintenance $600. Reduce this allowance when adding the same costs as dated events to avoid double counting. Costco not included until confirmed.');
insert into public.categories(id,name,monthly_cents,"group",rollover,start_month,color)
select id,name,cents,grp,rollover,date_trunc('month',now() at time zone 'America/New_York')::date,color from (values
 ('luke','Luke',5000,'flexible',true,'#467dcd'),('samantha','Samantha',5000,'flexible',true,'#b46b91'),('dates','Dates',10000,'flexible',false,'#b68636'),('gas','Gas',17500,'flexible',false,'#548a78'),('household','Household & Kids',15000,'flexible',false,'#7576a6'),('carwash','Car wash',1500,'flexible',false,'#548a78'),('offering','Fast offering',2500,'flexible',false,'#467dcd'),('medical','Medical',1000,'flexible',false,'#b46b91'),('food','Food cash',0,'flexible',false,'#b68636'),
 ('electricity','Electricity',35000,'fixed',false,'#548a78'),('water','Water',4500,'fixed',false,'#467dcd'),('trash','Trash',3100,'fixed',false,'#7576a6'),('internet','WOW internet',9200,'fixed',false,'#548a78'),('insurance','Car insurance',10200,'fixed',false,'#467dcd'),('gym','Gym',1300,'fixed',false,'#b68636'),('chatgpt','ChatGPT',2000,'fixed',false,'#7576a6'),('pgsharp','PGSharp',500,'fixed',false,'#b46b91'),('shopify','Shopify',4191,'business',false,'#548a78'),('epidemic','Epidemic Sound',1799,'business',false,'#b68636')
) as x(id,name,cents,grp,rollover,color);
insert into public.tasks(title,assignee,priority,notes,suggestion_key) values
 ('Lower WOW internet','Luke','Normal','Current plan is approximately $92 per month.','internet'),
 ('Arrange Georgia Power assessment','Samantha','Normal','Review the temporary $350 electricity ceiling after the assessment.','audit'),
 ('Complete vehicle title / registration','Luke','Normal','Enter the confirmed cost and date in Plan.','registration'),
 ('Enter tuition and funding dates','Luke','High','Confirm remaining tuition and when Peach State funding begins.','tuition');

-- Realtime carries only RLS-protected household tables.
do $$ declare t text; begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
 foreach t in array array['categories','monthly_limits','transactions','tasks','financial_events','reservoir_entries','settings','accounts'] loop
 execute format('alter publication supabase_realtime add table public.%I',t);
 end loop;
 end if;
end $$;
commit;
