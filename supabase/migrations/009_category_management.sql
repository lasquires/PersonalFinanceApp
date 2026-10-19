begin;

create function public.delete_household_category(category_id text, replacement_id text default null)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.can_write_household() then
    raise exception 'Household write access required' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(62804901);
  perform 1 from public.categories c where c.id=$1 for update;
  if not found then raise exception 'Category no longer exists'; end if;
  if $2=$1 then raise exception 'Choose another category'; end if;
  if $2 is not null and not exists(select 1 from public.categories c where c.id=$2) then
    raise exception 'Replacement category does not exist';
  end if;
  if $2 is null and exists(
    select 1 from public.transactions t, jsonb_array_elements(t.splits) s
    where s->>'category_id'=$1
  ) then raise exception 'Choose a replacement for split purchases'; end if;

  perform set_config('app.origin','member',true);
  update public.transactions t set category_id=$2,
    budget_state=case when $2 is null and t.budget_state<>'matched' then 'unbudgeted' else t.budget_state end,
    needs_review=case when $2 is null and t.kind='expense' and not t.excluded then true else t.needs_review end
  where t.category_id=$1;
  if $2 is not null then
    update public.transactions t set splits=(
      select jsonb_agg(case when s.value->>'category_id'=$1
        then jsonb_set(s.value,'{category_id}',to_jsonb($2)) else s.value end order by s.ordinality)
      from jsonb_array_elements(t.splits) with ordinality s(value,ordinality)
    ) where exists(select 1 from jsonb_array_elements(t.splits) s where s->>'category_id'=$1);
  end if;
  update public.tasks t set category_id=$2 where t.category_id=$1;
  update public.dashboard_preferences p set category_ids=array_remove(p.category_ids,$1)
    where p.category_ids is not null and $1=any(p.category_ids);
  if $2 is null then
    delete from private.merchant_category_rules r where r.category_id=$1;
  else
    update private.merchant_category_rules r set category_id=$2,updated_at=now() where r.category_id=$1;
  end if;
  delete from public.monthly_limits l where l.category_id=$1;
  delete from public.categories c where c.id=$1;
  perform private.refresh_import_holds();
end $$;

revoke all on function public.delete_household_category(text,text) from public,anon;
grant execute on function public.delete_household_category(text,text) to authenticated;
commit;
