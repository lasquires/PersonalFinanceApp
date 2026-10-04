begin;

alter table public.transactions add column budget_state text not null default 'budgeted'
  check (budget_state in ('unbudgeted','budgeted','held','matched'));
alter table public.transactions add column matched_manual_id text references public.transactions(id);
alter table public.transactions add constraint valid_manual_match check (
  (budget_state='matched') = (matched_manual_id is not null) and
  (matched_manual_id is null or (source<>'manual' and matched_manual_id<>id))
);
alter table public.transactions alter column budget_state set default 'unbudgeted';
create unique index one_active_bank_record_per_manual on public.transactions(matched_manual_id)
  where matched_manual_id is not null and not removed;
create index manual_purchase_candidates on public.transactions(amount_cents,date) where source='manual' and not removed;

create table private.import_match_rejections (
  import_id text not null references public.transactions(id),
  manual_id text not null references public.transactions(id),
  primary key(import_id,manual_id)
);
alter table private.import_match_rejections enable row level security;
revoke all on private.import_match_rejections from public,anon,authenticated;

create function private.merchants_similar(a text,b text) returns boolean language sql immutable set search_path='' as $$
  select lower(trim(a))=lower(trim(b)) or exists (
    select 1 from regexp_split_to_table(lower(a),'[^a-z0-9]+') x
    join regexp_split_to_table(lower(b),'[^a-z0-9]+') y on x=y
    where length(x)>=4 and x not in ('purchase','store','debit','card','payment')
  )
$$;
create function private.eligible_manual(imported public.transactions,manual public.transactions) returns boolean
language sql stable set search_path='' as $$
 select imported.source<>'manual' and not imported.removed and not imported.excluded and imported.kind='expense' and imported.currency='USD'
 and manual.source='manual' and not manual.removed and not manual.excluded and manual.kind='expense' and manual.currency='USD'
 and manual.budget_state='budgeted' and (manual.category_id is not null or jsonb_array_length(manual.splits)>0)
 and manual.amount_cents=imported.amount_cents and abs(manual.date-imported.date)<=7
 and (manual.account_id is null or imported.account_id is null or manual.account_id=imported.account_id)
 and not exists(select 1 from public.transactions linked where linked.matched_manual_id=manual.id and not linked.removed and linked.id<>imported.id)
 and not exists(select 1 from private.import_match_rejections r where r.import_id=imported.id and r.manual_id=manual.id)
$$;
create function private.refresh_import_holds() returns void language plpgsql security definer set search_path='' as $$
begin
  update public.transactions b set matched_manual_id=null,budget_state='unbudgeted',needs_review=true
  where b.matched_manual_id is not null and not b.removed and not exists (
    select 1 from public.transactions m where m.id=b.matched_manual_id and not m.removed and not m.excluded and m.kind='expense'
  );
  update public.transactions b set needs_review=(b.amount_cents<>m.amount_cents or b.currency<>m.currency)
  from public.transactions m where b.matched_manual_id=m.id and not b.removed
  and b.needs_review is distinct from (b.amount_cents<>m.amount_cents or b.currency<>m.currency);
  update public.transactions b set budget_state='held',needs_review=true
  where b.source<>'manual' and not b.removed and b.budget_state='budgeted'
  and exists(select 1 from public.transactions m where private.eligible_manual(b,m) and private.merchants_similar(b.merchant,m.merchant));
  update public.transactions b set budget_state=case when b.category_id is not null or jsonb_array_length(b.splits)>0 then 'budgeted' else 'unbudgeted' end,
  needs_review=(b.category_id is null and jsonb_array_length(b.splits)=0)
  where b.source<>'manual' and not b.removed and b.budget_state='held'
  and not exists(select 1 from public.transactions m where private.eligible_manual(b,m) and private.merchants_similar(b.merchant,m.merchant));
end $$;

create function private.prepare_import_budget() returns trigger language plpgsql security definer set search_path='' as $$
declare prior public.transactions; remembered text;
begin
  if new.source='manual' then return new; end if;
  select * into prior from public.transactions where id=new.id;
  if not found and new.pending_transaction_id is not null then
    select * into prior from public.transactions where id=new.pending_transaction_id and account_id=new.account_id;
    if found then
      -- Release the active unique link before its posted replacement is inserted.
      update public.transactions set removed=true where id=prior.id;
    end if;
  end if;
  if prior.id is not null then
    new.budget_state:=prior.budget_state; new.matched_manual_id:=prior.matched_manual_id;
    new.category_id:=prior.category_id;
    if (prior.budget_state='held' and (prior.amount_cents<>new.amount_cents or prior.currency<>new.currency)) or
      (prior.matched_manual_id is not null and exists(select 1 from public.transactions t
        where t.matched_manual_id=prior.matched_manual_id and not t.removed and t.id<>prior.id and t.id<>new.id)) then
      new.budget_state:='unbudgeted'; new.matched_manual_id:=null; new.needs_review:=true;
    end if;
    if new.id<>prior.id then
      insert into private.import_match_rejections(import_id,manual_id)
      select new.id,r.manual_id from private.import_match_rejections r where r.import_id=prior.id
      on conflict do nothing;
    end if;
  else
    select category_id into remembered from private.merchant_category_rules where merchant_key=private.merchant_key(new.merchant);
    new.user_modified:=false;
    new.category_id:=remembered;
    new.budget_state:=case when remembered is not null and new.kind='expense' and new.currency='USD' then 'budgeted' else 'unbudgeted' end;
    new.needs_review:=new.budget_state='unbudgeted' and new.kind='expense';
  end if;
  if new.budget_state in ('held','unbudgeted') and new.kind='expense' and not new.excluded then new.needs_review:=true; end if;
  return new;
end $$;
-- Rejection rows referring to a posted record are inserted before that record exists.
alter table private.import_match_rejections drop constraint import_match_rejections_import_id_fkey;
alter table private.import_match_rejections add constraint import_match_rejections_import_id_fkey
  foreign key(import_id) references public.transactions(id) deferrable initially deferred;
create trigger prepare_import_budget before insert on public.transactions for each row execute function private.prepare_import_budget();

-- UPSERT updates do not carry the new ledger columns from the original sync RPC.
create function private.guard_import_budget_update() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.source='manual' then return new; end if;
  if (old.budget_state='held' and (old.amount_cents<>new.amount_cents or old.currency<>new.currency)) or
    (new.matched_manual_id is not null and not new.removed and exists(select 1 from public.transactions t
      where t.matched_manual_id=new.matched_manual_id and not t.removed and t.id<>new.id)) then
    new.budget_state:='unbudgeted'; new.matched_manual_id:=null;
  end if;
  if new.budget_state in ('held','unbudgeted') and new.kind='expense' and not new.excluded then new.needs_review:=true; end if;
  return new;
end $$;
create trigger guard_import_budget_update before update on public.transactions for each row execute function private.guard_import_budget_update();

alter function public.household_action(text,jsonb,text) rename to household_action_before_reconciliation;
revoke all on function public.household_action_before_reconciliation(text,jsonb,text) from public,anon,authenticated;
create function public.household_action(action text,payload jsonb,origin text default 'member') returns void
language plpgsql security definer set search_path='' as $$
declare b public.transactions; m public.transactions; saved public.transactions; v_id text; source_value text; category_value text; splits_value jsonb; new_amount bigint;
begin
  if not public.can_write_household() then raise exception 'Household write access required' using errcode='42501'; end if;
  if origin<>'member' then raise exception 'Invalid origin'; end if;
  perform set_config('app.origin','member',true);
  if action not in ('transaction','delete_transaction','match_import','unmatch_import','separate_import') then
    perform public.household_action_before_reconciliation(action,payload,origin); return;
  end if;
  perform pg_advisory_xact_lock(62804901);
  if action in ('match_import','unmatch_import','separate_import') then
    select * into b from public.transactions where id=payload->>'import_id' for update;
    if not found or b.source='manual' or b.removed then raise exception 'This bank import is no longer available'; end if;
    if action='match_import' then
      if b.matched_manual_id is not null then raise exception 'Undo the existing match first'; end if;
      select * into m from public.transactions where id=payload->>'manual_id' for update;
      if not found or not private.eligible_manual(b,m) then raise exception 'Choose an eligible unmatched manual purchase'; end if;
      update public.transactions set budget_state='matched',matched_manual_id=m.id,needs_review=false,user_modified=true where id=b.id;
    elsif action='unmatch_import' then
      if b.matched_manual_id is null then raise exception 'This import has no match'; end if;
      update public.transactions set budget_state='unbudgeted',matched_manual_id=null,needs_review=true,user_modified=true where id=b.id;
    else
      if b.matched_manual_id is not null then raise exception 'Undo the match first'; end if;
      select * into m from public.transactions where id=payload->>'manual_id' for update;
      if not found or not private.eligible_manual(b,m) then raise exception 'Choose an eligible unmatched manual purchase'; end if;
      insert into private.import_match_rejections(import_id,manual_id)
      values(b.id,m.id)
      on conflict do nothing;
      update public.transactions set budget_state=case when category_id is not null or jsonb_array_length(splits)>0 then 'budgeted' else 'unbudgeted' end,
        needs_review=(category_id is null and jsonb_array_length(splits)=0),user_modified=true where id=b.id;
    end if;
  else
    v_id:=coalesce(payload->>'id',gen_random_uuid()::text);
    select * into saved from public.transactions where id=v_id for update;
    if action='delete_transaction' then
      update public.transactions set removed=true where id=v_id and source in ('manual','csv');
    else
      if saved.matched_manual_id is not null then raise exception 'Undo the match before editing this bank record'; end if;
      source_value:=coalesce(saved.source,payload->>'source','manual');
      if saved.id is null and source_value not in ('manual','csv') then raise exception 'Invalid transaction source'; end if;
      category_value:=nullif(payload->>'category_id',''); splits_value:=coalesce(payload->'splits','[]');
      new_amount:=case when saved.id is not null and saved.source<>'manual' then saved.amount_cents else (payload->>'amount_cents')::bigint end;
      if saved.id is not null then
        update public.transactions set
          merchant=case when source='manual' then payload->>'merchant' else merchant end,
          date=case when source='manual' then (payload->>'date')::date else date end,
          amount_cents=new_amount,account_id=case when source='manual' then nullif(payload->>'account_id','') else account_id end,
          category_id=category_value,kind=coalesce(payload->>'kind','expense'),excluded=coalesce((payload->>'excluded')::boolean,false),
          note=coalesce(payload->>'note',''),splits=splits_value,needs_review=false,user_modified=true,
          budget_state=case when category_value is not null or jsonb_array_length(splits_value)>0 then 'budgeted' else 'unbudgeted' end where id=v_id;
      else
        insert into public.transactions(id,merchant,date,amount_cents,account_id,category_id,kind,excluded,note,splits,source,currency,needs_review,user_modified,budget_state)
        values(v_id,payload->>'merchant',(payload->>'date')::date,new_amount,nullif(payload->>'account_id',''),category_value,
          coalesce(payload->>'kind','expense'),coalesce((payload->>'excluded')::boolean,false),coalesce(payload->>'note',''),splits_value,
          source_value,coalesce(payload->>'currency','USD'),false,true,case when category_value is not null or jsonb_array_length(splits_value)>0 then 'budgeted' else 'unbudgeted' end);
      end if;
      select * into saved from public.transactions where id=v_id;
      if coalesce((payload->>'remember_category')::boolean,false) then
        if saved.kind<>'expense' or saved.category_id is null or jsonb_array_length(saved.splits)>0 then raise exception 'A single purchase category is required to remember a merchant'; end if;
        insert into private.merchant_category_rules(merchant_key,merchant_name,category_id,created_by)
        values(private.merchant_key(saved.merchant),saved.merchant,saved.category_id,auth.uid())
        on conflict(merchant_key) do update set merchant_name=excluded.merchant_name,category_id=excluded.category_id,created_by=excluded.created_by,updated_at=now();
      end if;
    end if;
  end if;
  perform private.refresh_import_holds();
end $$;
revoke all on function public.household_action(text,jsonb,text) from public,anon;
grant execute on function public.household_action(text,jsonb,text) to authenticated;

alter function public.server_apply_sync(text,text,text,jsonb,jsonb,jsonb,jsonb) rename to server_apply_sync_before_reconciliation;
revoke all on function public.server_apply_sync_before_reconciliation(text,text,text,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
create function public.server_apply_sync(item text,expected_cursor text,next_cursor text,added jsonb,modified jsonb,removed jsonb,account_rows jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare applied boolean;
begin
  perform pg_advisory_xact_lock(62804901);
  applied:=public.server_apply_sync_before_reconciliation(item,expected_cursor,next_cursor,added,modified,removed,account_rows);
  if applied then perform private.refresh_import_holds(); end if;
  return applied;
end $$;
revoke all on function public.server_apply_sync(text,text,text,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.server_apply_sync(text,text,text,jsonb,jsonb,jsonb,jsonb) to service_role;

create function public.list_import_match_rejections(after_import_id text default null,after_manual_id text default null,page_size int default 1000)
returns table(import_id text,manual_id text) language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_member() then raise exception 'Household access required' using errcode='42501'; end if;
  return query select r.import_id,r.manual_id from private.import_match_rejections r
  where after_import_id is null or (r.import_id,r.manual_id)>(after_import_id,coalesce(after_manual_id,''))
  order by r.import_id,r.manual_id limit greatest(1,least(coalesce(page_size,1000),1000));
end $$;
revoke all on function public.list_import_match_rejections(text,text,int) from public,anon;
grant execute on function public.list_import_match_rejections(text,text,int) to authenticated;
revoke all on function private.merchants_similar(text,text),private.eligible_manual(public.transactions,public.transactions),private.refresh_import_holds(),private.prepare_import_budget(),private.guard_import_budget_update() from public,anon,authenticated;

create or replace view public.assistant_spending with (security_invoker=true) as
 select t.id,t.date,t.merchant,t.pending,coalesce(s->>'category_id',t.category_id,'uncategorized') as category_id,
 case when s is not null then (s->>'amount_cents')::bigint else t.amount_cents end as amount_cents
 from public.transactions t left join lateral jsonb_array_elements(t.splits) s on true
 where not t.excluded and not t.removed and t.kind='expense' and t.currency='USD' and t.budget_state='budgeted' and t.matched_manual_id is null;
commit;
