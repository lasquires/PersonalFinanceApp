import { allocations, budgetRows, forecast, monthOf } from '../finance';
import { countsInBudget } from '../reconciliation';
import type { Snapshot } from '../types';
import type { ReviewDetail, ReviewSummary } from './contracts';
import { calendarDate, periodEnd, shiftDate, type ReviewPeriod } from './periods';

export function buildReviewSnapshot(data:Snapshot,context:{snapshotId:string;generatedAt:string;period:ReviewPeriod;recentReviews:(ReviewSummary & {task_links?:ReviewDetail['task_links']})[]}) {
 const {period,generatedAt}=context; const asOf=calendarDate(new Date(generatedAt),period.timezone);
 const usd={...data,transactions:data.transactions.filter(t=>t.currency==='USD')};
 const rows=data.transactions.filter(t=>!t.removed&&t.date>=period.period_start&&t.date<=period.period_end);
 const counted=rows.filter(t=>t.currency==='USD'&&countsInBudget(t));
 const warnings:string[]=[];
 if(!period.complete)warnings.push('This reporting period is incomplete.');
 const foreign=rows.filter(t=>t.currency!=='USD');if(foreign.length)warnings.push(`${foreign.length} non-USD records are excluded from USD totals (unsupported currency).`);
 const unbudgeted=rows.filter(t=>t.kind==='expense'&&!t.excluded&&['held','unbudgeted'].includes(t.budget_state??''));
 if(unbudgeted.length)warnings.push(`${unbudgeted.length} imports are held or not in the budget; counted spending may understate purchases.`);
 const stale=data.accounts.filter(a=>!a.last_synced_at||Date.parse(generatedAt)-Date.parse(a.last_synced_at)>36*3600000||a.sync_error);
 if(stale.length)warnings.push(`${stale.length} accounts have missing, stale, or failed bank updates.`);
 if(!data.accounts.length)warnings.push('No bank accounts connected; this snapshot is not complete bank cash flow.');
 const months=[...new Set([monthOf(period.period_start),monthOf(period.period_end)])];
 const snap=[...data.snap_balances].sort((a,b)=>b.observed_at.localeCompare(a.observed_at))[0];
 const upcoming=data.events.filter(e=>!e.date||e.date<=shiftDate(asOf,90)&&(e.date>=asOf||e.recurring_monthly));
 const f=forecast(usd,asOf);
 return {
 schema_version:1 as const,snapshot_id:context.snapshotId,generated_at:generatedAt,timezone:period.timezone,currency:'USD' as const,kind:period.kind,period_start:period.period_start,period_end:period.period_end,
 coverage:{complete_period:period.complete,complete_bank_cash_flow:false,transaction_list_complete:true,unbudgeted_or_held_count:unbudgeted.length,pending_count:rows.filter(t=>t.pending).length,unreviewed_count:rows.filter(t=>t.needs_review).length,warnings,inclusion_rules:['Count budgeted USD expenses only, including signed refunds and pending reservations.','Matched bank imports do not count again; held/unbudgeted imports are visible but do not count.','Monthly budget context is through each month’s as_of date; period totals cover only the review window.','Scheduled events and restricted SNAP funds are not realized spending or unrestricted cash.','Reserve may overlap bank balances; do not add them.','Bank imports can overlap other sources; compare sources, never sum duplicates.']},
 monthly_budget:months.map(month=>({month,as_of:periodEnd('monthly',month)<asOf?periodEnd('monthly',month):asOf,categories:budgetRows(usd,month).map(c=>({id:c.id,name:c.name,group:c.group,rollover:c.rollover,budget_cents:c.budget,carried_cents:c.carried,spent_cents:c.spent,pending_spent_cents:c.pendingSpent,remaining_cents:c.remaining}))})),
 period_totals:{counted_spending_cents:counted.reduce((n,t)=>n+t.amount_cents,0),pending_counted_cents:counted.filter(t=>t.pending).reduce((n,t)=>n+t.amount_cents,0),categories:data.categories.map(c=>({id:c.id,name:c.name,spent_cents:counted.flatMap(allocations).filter(s=>s.category_id===c.id).reduce((n,s)=>n+s.amount_cents,0)}))},
 transactions:rows.map(t=>({id:t.id,account_id:t.account_id,merchant:t.merchant,date:t.date,amount_cents:t.amount_cents,currency:t.currency,pending:t.pending,kind:t.kind,excluded:t.excluded,category_id:t.category_id,splits:t.splits,source:t.source,budget_state:t.budget_state??'budgeted',matched_manual_id:t.matched_manual_id??null,needs_review:t.needs_review,counted_in_budget:t.currency==='USD'&&countsInBudget(t)})),
 accounts:data.accounts.map(a=>({id:a.id,name:a.name,institution:a.institution,type:a.type,member:a.member,balance_cents:a.balance_cents,balance_observed_at:a.last_synced_at,sync_issue:!!a.sync_error})),
 upcoming_events:upcoming.map(e=>({id:e.id,name:e.name,date:e.date,amount_cents:e.amount_cents,direction:e.direction,certainty:e.certainty,notes:e.notes,recurring_monthly:e.recurring_monthly,affects_runway:e.affects_runway,milestone:e.milestone})),
 snap_balance:snap?{benefit_month:snap.benefit_month,balance_cents:snap.balance_cents,observed_at:snap.observed_at,restricted_funds:true}:null,
 reserve_forecast:{estimated:true,as_of:asOf,start_balance_cents:f.startBalance,floor_cents:data.settings.floor_cents,annual_irregular_cents:data.settings.annual_irregular_cents,annual_notes:data.settings.annual_notes,months_to_floor:f.monthsToFloor,points:f.points.map(p=>({month:p.month,balance_cents:p.balance,planned_costs_cents:p.costs}))},
 tasks:data.tasks.map(t=>({id:t.id,title:t.title,status:t.status,priority:t.priority,assignee:t.assignee,due_date:t.due_date,notes:t.notes,impact_cents:t.impact_cents,impact_type:t.impact_type,category_id:t.category_id,event_id:t.event_id,task_key:t.suggestion_key?.startsWith('review:')?t.suggestion_key.slice(7):null})),
 recent_reviews:context.recentReviews.map(r=>({id:r.id,report_key:r.report_key,revision:r.revision,title:r.title,overview:r.overview,period_start:r.period_start,period_end:r.period_end,task_references:(r.task_links??[]).map(link=>({task_key:link.task_key,task_id:link.task_id,outcome:link.outcome}))})),
 };
}
export type ReviewSnapshot=ReturnType<typeof buildReviewSnapshot>;
