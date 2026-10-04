import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewPeriod, previousReviewPeriod } from '../src/lib/reviews/periods';
import { reviewPacketSchema } from '../src/lib/reviews/contracts';
import { buildReviewSnapshot } from '../src/lib/reviews/export';
import { defaults } from '../src/lib/defaults';
import { applyReviewPreview } from '../src/lib/reviews/preview';

export const packet = () => ({schema_version:1 as const,snapshot_id:'11111111-1111-4111-8111-111111111111',report_key:'weekly:2026-09-28',revision:1,kind:'weekly' as const,period_start:'2026-09-28',period_end:'2026-10-04',generated_at:'2026-10-05T13:00:00Z',title:'Weekly review',overview:'Keep enough for upcoming bills.',wins:[],concerns:[],stretch_plan:[],upcoming_priorities:[],follow_through:[],assumptions:[],missing_information:[],evidence:[],tasks:[]});
test('review periods follow household calendar boundaries, including DST',()=>{
 assert.equal(reviewPeriod('weekly','2026-09-28','America/New_York',new Date('2026-10-05T02:00:00Z')).period_end,'2026-10-04');
 assert.equal(reviewPeriod('weekly','2026-09-28','America/New_York',new Date('2026-10-05T02:00:00Z')).complete,false);
 assert.equal(previousReviewPeriod('weekly','America/New_York',new Date('2026-03-09T13:00:00Z')).period_start,'2026-03-02');
 assert.equal(previousReviewPeriod('monthly','America/New_York',new Date('2026-10-01T02:00:00Z')).period_start,'2026-08-01');
 assert.throws(()=>reviewPeriod('monthly','2026-02-30','America/New_York'),/date/i);
 assert.throws(()=>reviewPeriod('weekly','2026-09-29','America/New_York'),/Monday/);
 assert.throws(()=>reviewPeriod('weekly','2027-01-04','America/New_York',new Date('2026-10-05T13:00:00Z')),/future/i);
});
test('packet rejects invented fields, invalid dates, duplicate keys and broken evidence',()=>{
 assert.equal(reviewPacketSchema.safeParse(packet()).success,true);
 for(const extra of [{period_end:'2026-10-03'},{due_date:'2026-02-30'},{report_key:'anything'},{overview:'x'.repeat(2001)},{money_transfer:true}]) assert.equal(reviewPacketSchema.safeParse({...packet(),...extra}).success,false);
 const task={task_key:'review-gas',title:'Check gas',assignee:'Together',priority:'Normal',due_date:null,notes:'',impact_cents:0,impact_type:'once',basis:'suggested'};
 assert.equal(reviewPacketSchema.safeParse({...packet(),tasks:[task,task]}).success,false);
 assert.equal(reviewPacketSchema.safeParse({...packet(),wins:[{title:'Win',explanation:'Good',evidence_ids:['missing']}]}).success,false);
});
test('snapshot counts matched manual splits once and leaves imports and benefits distinct',()=>{
 const data=defaults(); data.transactions=[]; data.tasks=[]; data.events=[];
 const manual={id:'manual',account_id:null,merchant:'Store',date:'2026-10-01',amount_cents:1375,category_id:null,kind:'expense' as const,excluded:false,pending:false,removed:false,note:'private note',splits:[{category_id:'gas',amount_cents:375},{category_id:'household',amount_cents:1000}],source:'manual' as const,currency:'USD',needs_review:false,budget_state:'budgeted' as const};
 data.transactions=[manual,{...manual,id:'bank',source:'plaid',budget_state:'matched',matched_manual_id:'manual'},{...manual,id:'held',source:'plaid',budget_state:'held'},{...manual,id:'unbudgeted',source:'csv',budget_state:'unbudgeted'},{...manual,id:'refund',amount_cents:-375,splits:[],category_id:'gas'},{...manual,id:'removed',removed:true},{...manual,id:'euro',currency:'EUR'}];
 data.accounts=[{id:'checking',name:'Checking',institution:'Bank',type:'depository',member:'Luke',mask:'SECRET_MASK',item_id:'SECRET_ITEM',balance_cents:10000,last_synced_at:null,sync_error:null}];
 data.snap_balances=[{id:'snap',benefit_month:'2026-10-01',balance_cents:20000,observed_at:'2026-10-01T12:00:00Z',source:'muse'}];
 const snapshot=buildReviewSnapshot(data,{snapshotId:packet().snapshot_id,generatedAt:'2026-10-05T12:00:00Z',period:reviewPeriod('weekly','2026-09-28','America/New_York',new Date('2026-10-05T12:00:00Z')),recentReviews:[]});
 assert.equal(snapshot.period_totals.counted_spending_cents,1000);
 assert.equal(snapshot.coverage.unbudgeted_or_held_count,2);
 assert.equal(snapshot.transactions.find(t=>t.id==='bank')?.counted_in_budget,false);
 assert.equal(snapshot.snap_balance?.balance_cents,20000);
 const serialized=JSON.stringify(snapshot);
 for(const secret of ['SECRET_MASK','SECRET_ITEM','private note']) assert.equal(serialized.includes(secret),false);
 assert.ok(snapshot.coverage.warnings.some(w=>/currency/i.test(w)));
});
test('snapshot carries recent review task references for follow-through',()=>{
 const data=defaults();data.transactions=[];data.tasks=[];data.events=[];
 const recent={id:'22222222-2222-4222-8222-222222222222',report_key:'weekly:2026-09-21',revision:1,kind:'weekly' as const,period_start:'2026-09-21',period_end:'2026-09-27',title:'Last week',overview:'Watch groceries.',generated_at:'2026-09-28T13:00:00Z',saved_at:'2026-09-28T14:00:00Z',snapshot_generated_at:'2026-09-28T12:00:00Z',warnings:[]};
 const snapshot=buildReviewSnapshot(data,{snapshotId:packet().snapshot_id,generatedAt:'2026-10-05T12:00:00Z',period:reviewPeriod('weekly','2026-09-28','America/New_York',new Date('2026-10-05T12:00:00Z')),recentReviews:[{...recent,task_links:[{task_key:'pantry-plan',task_id:'task-1',outcome:'created'}]}]});
 assert.deepEqual(snapshot.recent_reviews[0].task_references,[{task_key:'pantry-plan',task_id:'task-1',outcome:'created'}]);
});
test('weekly snapshot keeps complete monthly context separate from weekly purchases',()=>{
 const data=defaults();data.transactions=[];data.events=[];
 const purchase={id:'later',account_id:null,merchant:'Groceries',date:'2026-09-20',amount_cents:8000,category_id:'household',kind:'expense' as const,excluded:false,pending:false,removed:false,note:'',splits:[],source:'manual' as const,currency:'USD',needs_review:false,budget_state:'budgeted' as const};
 data.transactions=[purchase];
 const snapshot=buildReviewSnapshot(data,{snapshotId:packet().snapshot_id,generatedAt:'2026-10-05T12:00:00Z',period:reviewPeriod('weekly','2026-09-07','America/New_York',new Date('2026-10-05T12:00:00Z')),recentReviews:[]});
 assert.equal(snapshot.period_totals.counted_spending_cents,0);
 assert.equal(snapshot.transactions.length,0);
 assert.equal(snapshot.monthly_budget[0].as_of,'2026-09-30');
 assert.equal(snapshot.monthly_budget[0].categories.find(c=>c.id==='household')?.spent_cents,8000);
});
test('upcoming events omit distant recurring plans but include near and active ones',()=>{
 const data=defaults();data.transactions=[];
 const base={id:'event',name:'Plan',date:'2026-10-20',amount_cents:1000,direction:'outflow' as const,certainty:'Estimated' as const,notes:'',affects_runway:true,recurring_monthly:true,milestone:false};
 data.events=[base,{...base,id:'distant',date:'2027-10-20'},{...base,id:'active',date:'2026-01-20'},{...base,id:'undated',date:null}];
 const snapshot=buildReviewSnapshot(data,{snapshotId:packet().snapshot_id,generatedAt:'2026-10-05T12:00:00Z',period:reviewPeriod('weekly','2026-09-28','America/New_York',new Date('2026-10-05T12:00:00Z')),recentReviews:[]});
 assert.deepEqual(snapshot.upcoming_events.map(e=>e.id),['event','active','undated']);
});
test('local review preview preserves task edits and deduplicates replays',()=>{
 const data=defaults();data.tasks=[];
 const snapshot=buildReviewSnapshot(data,{snapshotId:packet().snapshot_id,generatedAt:'2026-10-05T12:00:00Z',period:reviewPeriod('weekly','2026-09-28','America/New_York',new Date('2026-10-05T12:00:00Z')),recentReviews:[]});
 const p={...packet(),tasks:[{task_key:'gas-plan',title:'Check gas',assignee:'Together' as const,priority:'Normal' as const,due_date:null,notes:'',impact_cents:0,impact_type:'once' as const,basis:'suggested' as const}]};
 const first=applyReviewPreview(data,p,snapshot,new Date('2026-10-05T14:00:00Z'));
 assert.equal(first.data.tasks.length,1);first.data.tasks[0].status='Done';first.data.tasks[0].notes='User edit';
 const second=applyReviewPreview(first.data,p,snapshot,new Date('2026-10-05T14:00:00Z'));assert.equal(second.receipt.replayed,true);assert.equal(second.data.tasks.length,1);
 const revision=applyReviewPreview(first.data,{...p,revision:2},snapshot,new Date('2026-10-05T14:00:00Z'));assert.equal(revision.data.tasks[0].status,'Done');assert.equal(revision.data.tasks[0].notes,'User edit');
});
