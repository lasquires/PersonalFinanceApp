import { z } from 'zod';
import { periodEnd, validDate } from './periods';
export const REPORT_BYTE_LIMIT=256*1024;
export const SNAPSHOT_BYTE_LIMIT=2*1024*1024;
const date=z.string().refine(validDate,'Invalid calendar date');
const identifier=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/);
const text=z.string().trim().min(1).max(2000);
const nullableId=z.string().min(1).max(200).nullable().optional();
const entry=z.strictObject({title:z.string().trim().min(1).max(120),explanation:text,evidence_ids:z.array(identifier).max(50)});
const money=z.number().int().min(0).max(10_000_000_000);
export const reviewPacketSchema=z.strictObject({
 schema_version:z.literal(1),snapshot_id:z.uuid(),report_key:identifier,revision:z.number().int().min(1).max(10000),kind:z.enum(['weekly','monthly']),period_start:date,period_end:date,generated_at:z.iso.datetime({offset:true}),title:z.string().trim().min(1).max(120),overview:text,
 wins:z.array(entry).max(12),concerns:z.array(entry.extend({severity:z.enum(['high','medium','low'])})).max(12),stretch_plan:z.array(z.strictObject({action:text,tradeoff:text,savings_cents:money.nullable(),savings_period:z.enum(['once','weekly','monthly']),evidence_ids:z.array(identifier).max(50)})).max(12),upcoming_priorities:z.array(entry).max(12),follow_through:z.array(entry).max(12),assumptions:z.array(text).max(20),missing_information:z.array(text).max(20),
 evidence:z.array(z.strictObject({id:identifier,source:z.enum(['app_snapshot','chatgpt_plaid','conversation','external']),reference:z.string().min(1).max(500),observed_at:z.iso.datetime({offset:true}).nullable(),summary:text,confidence:z.enum(['high','medium','low']),url:z.url().refine(v=>new URL(v).protocol==='https:','HTTPS required').nullable().optional()})).max(50),
 tasks:z.array(z.strictObject({task_key:identifier,title:z.string().trim().min(1).max(200),assignee:z.enum(['Luke','Samantha','Together']),priority:z.enum(['High','Normal','Low']),due_date:date.nullable(),notes:z.string().max(1000),impact_cents:money,impact_type:z.enum(['once','monthly']),basis:z.enum(['agreed','suggested']),category_id:nullableId,event_id:nullableId,existing_task_id:nullableId})).max(20),
}).superRefine((p,ctx)=>{
 const issue=(path:(string|number)[],message:string)=>ctx.addIssue({code:'custom',path,message});
 if((p.kind==='weekly' && new Date(p.period_start+'T12:00:00Z').getUTCDay()!==1)||(p.kind==='monthly'&&p.period_start.slice(8)!=='01')||periodEnd(p.kind,p.period_start)!==p.period_end)issue(['period_start'],'Period boundaries do not match');
 if(p.report_key!==`${p.kind}:${p.period_start}`)issue(['report_key'],'Use kind:period_start');
 const ids=new Set(p.evidence.map(e=>e.id));
 if(ids.size!==p.evidence.length)issue(['evidence'],'Duplicate evidence ID');
 if(new Set(p.tasks.map(t=>t.task_key)).size!==p.tasks.length)issue(['tasks'],'Duplicate task key');
 for(const name of ['wins','concerns','stretch_plan','upcoming_priorities','follow_through'] as const) p[name].forEach((e,i)=>{for(const id of e.evidence_ids) if(!ids.has(id))issue([name,i,'evidence_ids'],'Unknown evidence reference');});
 for(const [i,e] of p.evidence.entries())if(e.source==='external'&&!e.url)issue(['evidence',i,'url'],'External evidence requires a source URL');
});
export type ReviewPacket=z.infer<typeof reviewPacketSchema>;
export type ReviewSummary={id:string;report_key:string;revision:number;kind:'weekly'|'monthly';period_start:string;period_end:string;title:string;overview:string;generated_at:string;saved_at:string;snapshot_generated_at:string;warnings:string[]};
export type ReviewReceipt={delivery_id:string;report_id:string;report_key:string;revision:number;saved_at:string;replayed:boolean;tasks_created:number;tasks_linked:number;warnings:string[];report_url:string};
export type ReviewDetail=ReviewSummary & {packet:ReviewPacket;task_links:{task_key:string;task_id:string|null;outcome:string}[]};
