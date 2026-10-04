import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { adminDb } from './auth';
import type { ReviewIdentity } from './reviews-auth';
import { buildReviewSnapshot } from '../reviews/export';
import { reviewPacketSchema, SNAPSHOT_BYTE_LIMIT, type ReviewDetail, type ReviewReceipt, type ReviewSummary } from '../reviews/contracts';
import { calendarDate, reviewPeriod, type ReviewKind } from '../reviews/periods';
import { canonicalJson, checkReviewDb, ReviewError } from '../reviews/http';
import { defaults } from '../defaults';
import type { Snapshot } from '../types';

export const reviewSummaryColumns='id,report_key,revision,kind,period_start,period_end,title,overview,generated_at,saved_at,snapshot_generated_at,warnings';
async function allRows(db:ReturnType<typeof adminDb>,table:string,columns:string,filter?:(q:any)=>any){
 const rows:any[]=[];
 if(table==='monthly_limits'){
  const {data,error}=await db.from(table).select(columns).order('category_id').order('month').limit(1000);checkReviewDb(error);
  if((data??[]).length>=1000)throw new ReviewError(413,'Too many monthly limits to export safely.');
  return data??[];
 }
 let cursor:string|undefined;
 for(let page=0;page<100;page++){
  let query=db.from(table).select(columns).order('id').limit(1000);
  if(filter)query=filter(query);
  if(cursor)query=query.gt('id',cursor);
  const {data,error}=await query;checkReviewDb(error);
  const batch=(data??[]) as unknown as {id:string}[];
  rows.push(...batch);if(batch.length<1000)return rows;
  cursor=batch[batch.length-1].id;
 }
 throw new ReviewError(413,'Too much history to export safely. Contact your administrator.');
}
export async function loadReviewSnapshot(identity:ReviewIdentity,kind:ReviewKind,start:string){
 const db=adminDb();const reserved=await db.rpc('server_reserve_review_request',{...identity,request_operation:'export'});checkReviewDb(reserved.error);
 const settings=await db.from('settings').select('id,floor_cents,annual_irregular_cents,annual_notes,timezone,forecast_months').eq('id',1).single();checkReviewDb(settings.error);
 if(!settings.data)throw new ReviewError(503,'Household settings are missing.');
 const period=reviewPeriod(kind,start,settings.data.timezone||'America/New_York');
 const generatedAt=new Date().toISOString();
 const contextAsOf=calendarDate(new Date(generatedAt),period.timezone);
 const sourceVersion=await db.from('review_source_versions').select('version').eq('id',1).single();checkReviewDb(sourceVersion.error);
 const data=defaults();data.settings=settings.data;data.members=[];data.invitations=[];data.tips=[];
 data.categories=await allRows(db,'categories','id,name,group,monthly_cents,rollover,start_month,color');
 data.limits=await allRows(db,'monthly_limits','category_id,month,amount_cents');
 data.transactions=(await allRows(db,'transactions','id,account_id,merchant,date,amount_cents,category_id,kind,excluded,pending,removed,splits,source,currency,needs_review,budget_state,matched_manual_id',q=>q.lte('date',contextAsOf))).map(t=>({...t,note:''}));
 data.accounts=(await allRows(db,'accounts','id,name,institution,member,type,balance_cents,last_synced_at,sync_error')).map(a=>({...a,mask:'',item_id:null}));
 data.tasks=await allRows(db,'tasks','id,title,status,priority,assignee,due_date,impact_cents,impact_type,notes,suggestion_key,category_id,event_id');
 data.events=await allRows(db,'financial_events','id,name,date,amount_cents,direction,certainty,notes,affects_runway,recurring_monthly,milestone');
 data.reservoir=await allRows(db,'reservoir_entries','id,date,amount_cents,note,kind,created_at');
 data.snap_balances=await allRows(db,'snap_balance_snapshots','id,benefit_month,balance_cents,observed_at,source');
 const recent=await db.from('financial_reviews').select(reviewSummaryColumns).order('period_end',{ascending:false}).order('revision',{ascending:false}).limit(100);checkReviewDb(recent.error);
 const latest=new Map<string,ReviewSummary>();for(const r of (recent.data??[]) as unknown as ReviewSummary[])if(!latest.has(r.report_key))latest.set(r.report_key,r);
 const recentReviews=[...latest.values()].slice(0,12);
 const links=recentReviews.length?await db.from('financial_review_task_links').select('report_id,task_key,task_id,outcome').in('report_id',recentReviews.map(r=>r.id)):null;
 if(links)checkReviewDb(links.error);
 const linkedByReport=new Map<string,ReviewDetail['task_links']>();
 for(const link of links?.data??[]){const current=linkedByReport.get(link.report_id)??[];current.push({task_key:link.task_key,task_id:link.task_id,outcome:link.outcome});linkedByReport.set(link.report_id,current);}
 const endVersion=await db.from('review_source_versions').select('version').eq('id',1).single();checkReviewDb(endVersion.error);
 if(String(sourceVersion.data?.version)!==String(endVersion.data?.version))throw new ReviewError(503,'Transactions changed during export. Please retry.');
 const snapshot=buildReviewSnapshot(data as Snapshot,{snapshotId:randomUUID(),generatedAt,period,recentReviews:recentReviews.map(r=>({...r,task_links:linkedByReport.get(r.id)??[]}))});
 const serialized=JSON.stringify(snapshot);
 if(Buffer.byteLength(serialized)>SNAPSHOT_BYTE_LIMIT)throw new ReviewError(413,'Snapshot exceeds 2 MiB. Choose a weekly period instead.');
 const recorded=await db.rpc('server_record_review_snapshot',{...identity,snapshot_id:snapshot.snapshot_id,review_kind:kind,start_date:period.period_start,end_date:period.period_end,exported_at:snapshot.generated_at,snapshot_hash:createHash('sha256').update(serialized).digest('hex'),snapshot_coverage:snapshot.coverage});checkReviewDb(recorded.error);
 return snapshot;
}
export async function reserveReviewDelivery(identity:ReviewIdentity){const {error}=await adminDb().rpc('server_reserve_review_request',{...identity,request_operation:'delivery'});checkReviewDb(error);}
export async function deliverReview(identity:ReviewIdentity,input:unknown):Promise<ReviewReceipt>{
 const db=adminDb();
 const parsed=reviewPacketSchema.safeParse(input);
 if(!parsed.success)throw new ReviewError(400,'Correct the packet fields before sending again.',[...new Set(parsed.error.issues.map(i=>i.path.join('.')))].slice(0,30));
 const {data,error}=await db.rpc('server_save_financial_review',{...identity,review_packet:parsed.data,packet_hash:createHash('sha256').update(canonicalJson(parsed.data)).digest('hex')});checkReviewDb(error);
 return data as ReviewReceipt;
}
export async function readReviewReceipt(identity:ReviewIdentity,id:string):Promise<ReviewReceipt>{
 if(!/^[0-9a-f-]{36}$/i.test(id))throw new ReviewError(400,'Invalid receipt ID.');
 const db=adminDb();
 // Receipts contain no raw snapshot. Viewers are allowed household read access.
 if(identity.courier_hash){const auth=await db.rpc('server_review_identity',identity);checkReviewDb(auth.error);}
 else {const member=await db.from('members').select('id').eq('id',identity.member_id).maybeSingle();checkReviewDb(member.error);if(!member.data)throw new ReviewError(403,'Household access required.');}
 const {data,error}=await db.from('review_delivery_receipts').select('receipt').eq('id',id).maybeSingle();checkReviewDb(error);
 if(!data)throw new ReviewError(404,'Receipt not found.');return data.receipt as ReviewReceipt;
}
