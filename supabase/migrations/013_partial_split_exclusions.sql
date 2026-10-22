begin;

-- Split exclusions live inside the existing JSONB split array. No transaction
-- rows are rewritten: old splits without an excluded flag remain included.
-- Keep ChatGPT/assistant budget totals consistent with the application UI.
create or replace view public.assistant_spending with (security_invoker=true) as
select
  t.id,
  t.date,
  t.merchant,
  t.pending,
  coalesce(s->>'category_id',t.category_id,'uncategorized') as category_id,
  case when s is not null then (s->>'amount_cents')::bigint else t.amount_cents end as amount_cents
from public.transactions t
left join lateral jsonb_array_elements(t.splits) s on true
where not t.excluded
  and not t.removed
  and t.currency='USD'
  and t.budget_state='budgeted'
  and t.matched_manual_id is null
  and (
    t.kind='expense'
    or (t.kind='income' and t.amount_cents<0 and (t.category_id is not null or jsonb_array_length(t.splits)>0))
  )
  and coalesce((s->>'excluded')::boolean,false)=false;

commit;
