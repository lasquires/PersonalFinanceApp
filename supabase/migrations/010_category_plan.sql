begin;

create function public.apply_category_plan(changes jsonb, expected_categories jsonb, start_month date)
returns void language plpgsql security definer set search_path='' as $$
declare
  item jsonb;
  target text;
  replacement text;
  action_name text;
  current_name text;
  snapshot jsonb;
  touched text[] := '{}';
  deleted text[] := '{}';
begin
  if not public.can_write_household() then
    raise exception 'Household write access required' using errcode='42501';
  end if;
  if jsonb_typeof(changes) is distinct from 'array' or jsonb_array_length(changes) not between 1 and 30 then
    raise exception 'Plan must contain 1 to 30 changes';
  end if;
  if start_month is null or extract(day from start_month) <> 1 then
    raise exception 'Choose a valid budget month';
  end if;
  perform pg_advisory_xact_lock(62804901);
  select coalesce(jsonb_object_agg(id,jsonb_build_object('name',name,'group',"group",'monthly_cents',monthly_cents,'rollover',rollover)),'{}'::jsonb)
    into snapshot from public.categories;
  if snapshot is distinct from expected_categories then
    raise exception 'Categories changed; refresh and copy new instructions';
  end if;

  select coalesce(array_agg(value->>'id'),'{}'::text[]) into deleted
    from jsonb_array_elements(changes) value where value->>'action'='delete';
  for item in select value from jsonb_array_elements(changes) value loop
    if jsonb_typeof(item) is distinct from 'object' then raise exception 'Invalid plan entry'; end if;
    action_name := item->>'action';
    target := item->>'id';
    if action_name not in ('add','update','delete') or action_name is null then raise exception 'Unknown plan action'; end if;
    if action_name <> 'add' then
      if target is null or target = any(touched) then raise exception 'Duplicate or missing category id'; end if;
      touched := array_append(touched,target);
      select name into current_name from public.categories where id=target;
      if not found then raise exception 'Unknown category id'; end if;
    end if;
    if action_name='delete' then
      replacement := item->>'replacement_id';
      if item->'confirm_delete' is distinct from 'true'::jsonb
        or item->>'confirm_name' is distinct from current_name
        or length(trim(coalesce(item->>'reason',''))) < 10 then
        raise exception 'Explicit delete confirmation, exact name, and reason required';
      end if;
      if replacement is null or replacement=target or replacement=any(deleted)
        or not exists(select 1 from public.categories where id=replacement) then
        raise exception 'Choose a surviving replacement category';
      end if;
    elsif action_name='add' then
      if nullif(trim(coalesce(item->>'name','')),'') is null
        or item->>'group' not in ('flexible','fixed','business')
        or jsonb_typeof(item->'monthly_cents') is distinct from 'number'
        or jsonb_typeof(item->'rollover') is distinct from 'boolean' then
        raise exception 'Invalid new category';
      end if;
    else
      if item ? 'name' and nullif(trim(item->>'name'),'') is null then raise exception 'Invalid category name'; end if;
      if item ? 'group' and item->>'group' not in ('flexible','fixed','business') then raise exception 'Invalid category group'; end if;
      if item ? 'monthly_cents' and jsonb_typeof(item->'monthly_cents') is distinct from 'number' then raise exception 'Invalid category amount'; end if;
      if item ? 'rollover' and jsonb_typeof(item->'rollover') is distinct from 'boolean' then raise exception 'Invalid rollover setting'; end if;
    end if;
  end loop;

  perform set_config('app.origin','member',true);
  for item in select value from jsonb_array_elements(changes) value loop
    action_name := item->>'action';
    if action_name='add' then
      insert into public.categories(id,name,"group",monthly_cents,rollover,start_month,color)
      values(gen_random_uuid()::text,trim(item->>'name'),item->>'group',(item->>'monthly_cents')::bigint,(item->>'rollover')::boolean,start_month,'#548a78');
    elsif action_name='update' then
      update public.categories set
        name=case when item ? 'name' then trim(item->>'name') else name end,
        "group"=case when item ? 'group' then item->>'group' else "group" end,
        monthly_cents=case when item ? 'monthly_cents' then (item->>'monthly_cents')::bigint else monthly_cents end,
        rollover=case when item ? 'rollover' then (item->>'rollover')::boolean else rollover end
      where id=item->>'id';
    else
      perform public.delete_household_category(item->>'id',item->>'replacement_id');
    end if;
  end loop;
  if exists(select 1 from public.categories group by lower(name) having count(*)>1) then
    raise exception 'Duplicate category name';
  end if;
end $$;

revoke all on function public.apply_category_plan(jsonb,jsonb,date) from public,anon;
grant execute on function public.apply_category_plan(jsonb,jsonb,date) to authenticated;
commit;

