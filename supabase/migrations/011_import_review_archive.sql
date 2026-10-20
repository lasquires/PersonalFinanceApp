begin;

create function private.preserve_import_review_decision() returns trigger
language plpgsql security definer set search_path='' as $$
declare prior public.transactions;
begin
  if new.source='manual' then return new; end if;
  if tg_op='UPDATE' then
    prior:=old;
  else
    select * into prior from public.transactions where id=new.id;
    if prior.id is null and new.pending_transaction_id is not null then
      select * into prior from public.transactions
      where id=new.pending_transaction_id and account_id=new.account_id;
    end if;
  end if;
  if new.excluded then
    new.needs_review:=false;
  elsif prior.id is not null and prior.user_modified and not prior.needs_review
    and prior.amount_cents=new.amount_cents and prior.currency=new.currency
    and new.budget_state in ('budgeted','matched')
    and (new.matched_manual_id is null or not exists (
      select 1 from public.transactions manual
      where manual.id=new.matched_manual_id
        and (manual.amount_cents<>new.amount_cents or manual.currency<>new.currency)
    )) then
    new.needs_review:=false;
  end if;
  return new;
end $$;

create trigger zz_preserve_import_review_decision
before insert or update on public.transactions
for each row execute function private.preserve_import_review_decision();

-- Old syncs did not retain the review decision for simple categorized imports.
-- Split and matched records stay flagged because their amount may need reconciliation.
update public.transactions set needs_review=false
where source<>'manual' and not removed and user_modified and needs_review
  and (excluded or (budget_state='budgeted' and category_id is not null
    and jsonb_array_length(splits)=0));

commit;
