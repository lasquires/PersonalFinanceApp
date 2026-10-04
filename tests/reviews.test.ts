import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewPeriod, previousReviewPeriod } from '../src/lib/reviews/periods';
import { reviewPacketSchema } from '../src/lib/reviews/contracts';
import { buildReviewSnapshot } from '../src/lib/reviews/export';
import { defaults } from '../src/lib/defaults';

export const packet = () => ({schema_version:1,snapshot_id:'11111111-1111-4111-8111-111111111111',report_key:'weekly:2026-09-28',revision:1,kind:'weekly',period_start:'2026-09-28',period_end:'2026-10-04',generated_at:'2026-10-05T13:00:00Z',title:'Weekly review',overview:'Keep enough for upcoming bills.',wins:[],concerns:[],stretch_plan:[],upcoming_priorities:[],follow_through:[],assumptions:[],missing_information:[],evidence:[],tasks:[]});
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
