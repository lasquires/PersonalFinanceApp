begin;

alter table public.transactions add column removal_review_state text
  check (removal_review_state in ('open','recorded','dismissed'));
alter table public.transactions add column removal_manual_id text references public.transactions(id) on delete set null;
create index removed_imports_to_review on public.transactions(date desc)
  where removal_review_state='open';

create function private.review_removed_import(import_id text) returns void
language plpgsql security definer set search_path='' as $$
declare bank public.transactions; manual_id text;
begin
  select * into bank from public.transactions where id=import_id for update;
  if not found or bank.source<>'plaid' or not bank.removed or bank.pending or bank.excluded
     or bank.kind<>'expense' or bank.amount_cents<=0 or bank.currency<>'USD'
     or bank.removal_review_state is not null then return; end if;
  if exists(select 1 from public.transactions replacement
    where replacement.pending_transaction_id=bank.id and not replacement.removed) then return; end if;
  select manual.id into manual_id from public.transactions manual
  where manual.source='manual' and not manual.removed and not manual.excluded
    and manual.kind='expense' and manual.currency='USD' and manual.budget_state='budgeted'
    and manual.amount_cents=bank.amount_cents and abs(manual.date-bank.date)<=7
    and (manual.account_id is null or manual.account_id=bank.account_id)
    and lower(trim(manual.merchant))=lower(trim(bank.merchant))
    and (manual.category_id is not null or jsonb_array_length(manual.splits)>0)
  order by abs(manual.date-bank.date),manual.id limit 1;
  update public.transactions set removal_review_state=case when manual_id is null then 'open' else 'recorded' end,
    removal_manual_id=manual_id where id=bank.id;
end $$;
revoke all on function private.review_removed_import(text) from public,anon,authenticated;

alter function public.server_apply_sync(text,text,text,jsonb,jsonb,jsonb,jsonb)
  rename to server_apply_sync_before_removed_review;
revoke all on function public.server_apply_sync_before_removed_review(text,text,text,jsonb,jsonb,jsonb,jsonb)
  from public,anon,authenticated,service_role;
create function public.server_apply_sync(item text,expected_cursor text,next_cursor text,added jsonb,modified jsonb,removed jsonb,account_rows jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare applied boolean; entry jsonb;
begin
  applied:=public.server_apply_sync_before_removed_review(item,expected_cursor,next_cursor,added,modified,removed,account_rows);
  if not applied then return false; end if;
  for entry in select * from jsonb_array_elements(added || modified) loop
    update public.transactions t set removal_review_state=null,removal_manual_id=null
    where t.id=entry->>'id' and not t.removed and t.removal_review_state is not null;
  end loop;
  for entry in select * from jsonb_array_elements(removed) loop
    if exists(select 1 from public.transactions t join public.accounts a on a.id=t.account_id
      where t.id=entry->>'transaction_id' and a.item_id=item) then
      perform private.review_removed_import(entry->>'transaction_id');
    end if;
  end loop;
  return true;
end $$;
revoke all on function public.server_apply_sync(text,text,text,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.server_apply_sync(text,text,text,jsonb,jsonb,jsonb,jsonb) to service_role;

create function public.resolve_removed_import(import_id text,resolution text,chosen_category_id text default null)
returns text language plpgsql security definer set search_path='' as $$
declare bank public.transactions; manual_id text; selected_category text;
begin
  if not public.can_write_household() then
    raise exception 'Household write access required' using errcode='42501';
  end if;
  if resolution not in ('keep','dismiss') then raise exception 'Invalid resolution'; end if;
  select * into bank from public.transactions where id=import_id for update;
  if not found or bank.removal_review_state is distinct from 'open' or not bank.removed then
    raise exception 'This bank change was already reviewed';
  end if;
  if resolution='dismiss' then
    update public.transactions set removal_review_state='dismissed' where id=import_id;
    return null;
  end if;
  selected_category:=coalesce(chosen_category_id,bank.category_id);
  if selected_category is null or not exists(select 1 from public.categories where id=selected_category) then
    raise exception 'Choose a category for this purchase';
  end if;
  select manual.id into manual_id from public.transactions manual
  where manual.source='manual' and not manual.removed and not manual.excluded
    and manual.kind='expense' and manual.currency='USD' and manual.budget_state='budgeted'
    and manual.amount_cents=bank.amount_cents and abs(manual.date-bank.date)<=7
    and (manual.account_id is null or manual.account_id=bank.account_id)
    and lower(trim(manual.merchant))=lower(trim(bank.merchant))
  order by abs(manual.date-bank.date),manual.id limit 1;
  if manual_id is null then
    manual_id:=gen_random_uuid()::text;
    insert into public.transactions(id,account_id,merchant,date,amount_cents,category_id,kind,
      excluded,pending,removed,note,splits,source,currency,needs_review,user_modified,budget_state)
    values(manual_id,bank.account_id,bank.merchant,bank.date,bank.amount_cents,selected_category,'expense',
      false,false,false,'Kept after bank feed removed the posted purchase','[]'::jsonb,'manual','USD',false,true,'budgeted');
  end if;
  update public.transactions set removal_review_state='recorded',removal_manual_id=manual_id where id=import_id;
  perform private.refresh_import_holds();
  return manual_id;
end $$;
revoke all on function public.resolve_removed_import(text,text,text) from public,anon;
grant execute on function public.resolve_removed_import(text,text,text) to authenticated;

do $$ declare entry record; begin
  for entry in select id from public.transactions where source='plaid' and removed and not pending
    and kind='expense' and amount_cents>0 and currency='USD' and not excluded
    and date>=current_date-90 and removal_review_state is null loop
    perform private.review_removed_import(entry.id);
  end loop;
end $$;

commit;

