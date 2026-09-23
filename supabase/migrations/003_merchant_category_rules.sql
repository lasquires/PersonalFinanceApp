begin;

create function private.merchant_key(value text) returns text
language sql immutable set search_path=''
as $$ select regexp_replace(lower(trim(value)), '\s+', ' ', 'g') $$;

create table private.merchant_category_rules (
  merchant_key text primary key check(length(merchant_key) between 1 and 300),
  merchant_name text not null check(length(merchant_name) between 1 and 300),
  category_id text not null references public.categories(id),
  created_by uuid references public.members(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table private.merchant_category_rules enable row level security;

create or replace function public.household_action(action text, payload jsonb, origin text default 'member')
returns void language plpgsql security definer set search_path='' as $$
declare saved public.transactions;
begin
  if not public.can_write_household() then
    raise exception 'Household write access required' using errcode='42501';
  end if;
  if origin<>'member' then raise exception 'Invalid origin'; end if;
  perform public.household_action_unchecked(action,payload,'member');

  if action='transaction' and coalesce((payload->>'remember_category')::boolean,false) then
    select * into saved from public.transactions where id=payload->>'id';
    if saved.kind<>'expense' or saved.category_id is null or jsonb_array_length(saved.splits)>0 then
      raise exception 'A single purchase category is required to remember a merchant';
    end if;
    insert into private.merchant_category_rules(merchant_key,merchant_name,category_id,created_by)
    values(private.merchant_key(saved.merchant),saved.merchant,saved.category_id,auth.uid())
    on conflict(merchant_key) do update set
      merchant_name=excluded.merchant_name,
      category_id=excluded.category_id,
      created_by=excluded.created_by,
      updated_at=now();
  end if;
end $$;

create function private.apply_merchant_category_rule() returns trigger
language plpgsql security definer set search_path='' as $$
declare remembered text;
begin
  if new.source='plaid' and not new.user_modified and new.kind='expense' then
    select category_id into remembered
    from private.merchant_category_rules
    where merchant_key=private.merchant_key(new.merchant);
    if found then
      new.category_id:=remembered;
      new.needs_review:=false;
    end if;
  end if;
  return new;
end $$;

create trigger apply_merchant_category_rule
before insert on public.transactions
for each row execute function private.apply_merchant_category_rule();

commit;
