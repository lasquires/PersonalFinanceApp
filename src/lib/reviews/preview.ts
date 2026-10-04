import type { Snapshot,Task } from '../types';
import { reviewPacketSchema,type ReviewPacket,type ReviewDetail,type ReviewReceipt } from './contracts';
import type { ReviewSnapshot } from './export';
import { canonicalJson } from './http';
export function applyReviewPreview(data:Snapshot,input:ReviewPacket,snapshot:ReviewSnapshot,now=new Date()){
 const p=reviewPacketSchema.parse(input);
 if(p.snapshot_id!==snapshot.snapshot_id||p.kind!==snapshot.kind||p.period_start!==snapshot.period_start||p.period_end!==snapshot.period_end)throw new Error('Packet does not match its exported snapshot.');
 if(Date.parse(p.generated_at)<Date.parse(snapshot.generated_at)||Date.parse(p.generated_at)>now.getTime()+300000)throw new Error('Invalid report generation time.');
 const previous=Object.values(data.preview_review_details??{}).find(r=>r.report_key===p.report_key&&r.revision===p.revision);
 if(previous){if(canonicalJson(previous.packet)!==canonicalJson(p))throw new Error('That revision already has different content.');return {data,receipt:{...data.preview_review_receipts![previous.id],replayed:true}};}
 const last=Math.max(0,...(data.reviews??[]).filter(r=>r.report_key===p.report_key).map(r=>r.revision));if(p.revision!==last+1)throw new Error(`Expected revision ${last+1}.`);
 const next=structuredClone(data);const keys=next.preview_review_task_keys??={};const warnings=[...snapshot.coverage.warnings];let created=0,linked=0;
 const links:ReviewDetail['task_links']=[];
 for(const t of p.tasks){
  if(t.category_id&&!next.categories.some(c=>c.id===t.category_id))throw new Error('Invalid task category.');
  if(t.event_id&&!next.events.some(e=>e.id===t.event_id))throw new Error('Invalid task event.');
  if(t.existing_task_id&&!next.tasks.some(e=>e.id===t.existing_task_id))throw new Error('Invalid existing task reference.');
  let task:Task|undefined;let outcome='linked';
  if(t.task_key in keys){task=next.tasks.find(v=>v.id===keys[t.task_key]);if(!task){outcome='deleted';warnings.push('Previously deleted task not recreated: '+t.title);}}
  else {
   task=t.existing_task_id?next.tasks.find(v=>v.id===t.existing_task_id):next.tasks.find(v=>v.assignee===t.assignee&&v.title.trim().toLowerCase().replace(/\s+/g,' ')===t.title.trim().toLowerCase().replace(/\s+/g,' '));
   if(task&&!t.existing_task_id&&['Done','Dismissed'].includes(task.status)){task=undefined;outcome='terminal';warnings.push('Equivalent completed or dismissed task not reopened: '+t.title);}
   else if(!task){task={id:crypto.randomUUID(),title:t.title,assignee:t.assignee,priority:t.priority,due_date:t.due_date,notes:(t.basis==='agreed'?'Agreed in discussion. ':'New suggestion. ')+t.notes,impact_cents:t.impact_cents,impact_type:t.impact_type,status:'Suggested',suggestion_key:'review:'+t.task_key,category_id:t.category_id??null,event_id:t.event_id??null};next.tasks.push(task);created++;outcome='created';}
   keys[t.task_key]=task?.id??null;
  }
  if(task&&outcome!=='created')linked++;links.push({task_key:t.task_key,task_id:task?.id??null,outcome});
 }
 const id=crypto.randomUUID();const savedAt=now.toISOString();
 const detail:ReviewDetail={id,report_key:p.report_key,revision:p.revision,kind:p.kind,period_start:p.period_start,period_end:p.period_end,title:p.title,overview:p.overview,generated_at:p.generated_at,saved_at:savedAt,snapshot_generated_at:snapshot.generated_at,warnings,packet:p,task_links:links};
 const {packet:_packet,task_links:_links,...summary}=detail;
 const receipt:ReviewReceipt={delivery_id:crypto.randomUUID(),report_id:id,report_key:p.report_key,revision:p.revision,saved_at:savedAt,replayed:false,tasks_created:created,tasks_linked:linked,warnings,report_url:'/?review='+id};
 next.reviews=[...(next.reviews??[]),summary];(next.preview_review_details??={})[id]=detail;(next.preview_review_receipts??={})[id]=receipt;
 return {data:next,receipt};
}
