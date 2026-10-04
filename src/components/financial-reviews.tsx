'use client';
import { useEffect,useRef,useState } from 'react';
import { ArrowLeft,ArrowUpRight,CheckCheck,ChevronRight,Download,FileText,Upload } from 'lucide-react';
import { browserDb } from '@/lib/supabase/client';
import { money } from '@/lib/finance';
import type { MemberRole,Snapshot } from '@/lib/types';
import { REPORT_BYTE_LIMIT,reviewPacketSchema,type ReviewDetail,type ReviewPacket,type ReviewReceipt } from '@/lib/reviews/contracts';
import { buildReviewSnapshot,type ReviewSnapshot } from '@/lib/reviews/export';
import { previousReviewPeriod,reviewPeriod,type ReviewKind } from '@/lib/reviews/periods';
import { buildReviewHandoff } from '@/lib/reviews/handoff';
import { downloadReviewFile } from '@/lib/reviews/download';
import { Empty,FormError } from './ui';

const dateLabel=(date:string)=>new Date(date+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
export function FinancialReviews({data,role,preview,refresh,selectedId,select,previewSave}:{data:Snapshot;role:MemberRole;preview:boolean;refresh:()=>Promise<void>;selectedId:string|null;select:(id:string|null)=>void;previewSave:(packet:ReviewPacket,snapshot:ReviewSnapshot)=>Promise<ReviewReceipt>}){
 const timezone=data.settings.timezone||'America/New_York';
 const [kind,setKind]=useState<ReviewKind>('weekly');const [start,setStart]=useState(()=>previousReviewPeriod('weekly',timezone).period_start);
 const [detail,setDetail]=useState<ReviewDetail|null>(null);const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');const [loading,setLoading]=useState(false);
 const snapshots=useRef(new Map<string,ReviewSnapshot>());
 useEffect(()=>{let active=true;setDetail(null);setError('');if(!selectedId)return;
  if(preview){setDetail(data.preview_review_details?.[selectedId]??null);return;}
  setLoading(true);
  void(async()=>{try{const db=browserDb();const report=await db.from('financial_reviews').select('*').eq('id',selectedId).single();if(report.error)throw new Error('This review could not be opened.');const parsed=reviewPacketSchema.safeParse(report.data.packet);if(!parsed.success)throw new Error('This review has an invalid packet.');const links=await db.from('financial_review_task_links').select('task_key,task_id,outcome').eq('report_id',selectedId);if(links.error)throw new Error('Review tasks could not be loaded.');if(active)setDetail({...report.data,packet:parsed.data,task_links:links.data??[]});}catch(e){if(active)setError((e as Error).message);}finally{if(active)setLoading(false);}})();return()=>{active=false;};
 },[selectedId,preview,data.preview_review_details]);
 const exportPacket=async()=>{setBusy(true);setError('');setMessage('');try{
  let snapshot:ReviewSnapshot;
  if(preview)snapshot=buildReviewSnapshot(data,{snapshotId:crypto.randomUUID(),generatedAt:new Date().toISOString(),period:reviewPeriod(kind,start,timezone),recentReviews:data.reviews??[]});
  else {const response=await fetch(`/api/reviews/snapshot?kind=${kind}&period_start=${encodeURIComponent(start)}`,{cache:'no-store'});const result=await response.json();if(!response.ok)throw new Error(result.error??'Export failed.');snapshot=result;}
  snapshots.current.set(snapshot.snapshot_id,snapshot);const handoff=buildReviewHandoff(snapshot);
  downloadReviewFile(`review-input-${kind}-${start}.json`,JSON.stringify({snapshot,analysis_instructions:handoff.analysisInstructions,packet_schema:handoff.schema,example_packet:handoff.examplePacket},null,2),'application/json');setMessage(preview?'Local preview packet exported.':'Review packet exported.');
 }catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 const importPacket=async(file:File)=>{setBusy(true);setError('');setMessage('');try{
  if(file.size>REPORT_BYTE_LIMIT)throw new Error('Review packet exceeds 256 KiB.');let raw:unknown;try{raw=JSON.parse(await file.text());}catch{throw new Error('Choose a valid JSON review packet.');}
  const parsed=reviewPacketSchema.safeParse(raw);if(!parsed.success)throw new Error('Correct the review packet: '+[...new Set(parsed.error.issues.map(i=>i.path.join('.')))].slice(0,8).join(', '));
  if(parsed.data.title.startsWith('TEMPLATE'))throw new Error('This is a template packet, not a finished review.');
  let receipt:ReviewReceipt;
  if(preview){const snapshot=snapshots.current.get(parsed.data.snapshot_id);if(!snapshot)throw new Error('Export a local preview packet first.');receipt=await previewSave(parsed.data,snapshot);}
  else {const response=await fetch('/api/reviews/reports',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(parsed.data)});const result=await response.json();if(!response.ok)throw new Error(result.error??'Import failed.');receipt=result;const verified=await fetch('/api/reviews/receipts/'+receipt.delivery_id,{cache:'no-store'});const confirmation=await verified.json();if(!verified.ok||confirmation.report_id!==receipt.report_id)throw new Error('Delivery receipt could not be verified. Retrying this file is safe.');await refresh();}
  setMessage(receipt.replayed?'Already delivered. No duplicate tasks created.':`${preview?'Saved in local preview. ':'Saved. '}${receipt.tasks_created} new tasks, ${receipt.tasks_linked} linked.`);select(receipt.report_id);
 }catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 const latest=new Map<string,NonNullable<Snapshot['reviews']>[number]>();for(const r of [...(data.reviews??[])].sort((a,b)=>b.revision-a.revision))if(!latest.has(r.report_key))latest.set(r.report_key,r);
 const history=[...latest.values()].filter(r=>r.kind===kind).sort((a,b)=>b.period_end.localeCompare(a.period_end));
 const changeKind=(value:ReviewKind)=>{setKind(value);setStart(previousReviewPeriod(value,timezone).period_start);setError('');};
 const entries=(title:string,items:{title:string;explanation:string;evidence_ids:string[]}[])=>items.length>0&&<section className="review-section"><h2>{title}</h2>{items.map((entry,i)=><div className="review-entry" key={i}><h3>{entry.title}</h3><p>{entry.explanation}</p>{entry.evidence_ids.length>0&&<small className="muted">Evidence: {entry.evidence_ids.join(', ')}</small>}</div>)}</section>;
 return <div className="financial-reviews">
  <div className="review-heading"><h1>{selectedId?'Financial review':'Reviews'}</h1>{selectedId&&<button className="text-btn" onClick={()=>select(null)}><ArrowLeft size={16}/>Back to reviews</button>}</div>
  <FormError error={error}/>{message&&<p className="review-status" role="status">{message}</p>}
  {loading&&<p className="muted" role="status">Opening review...</p>}
  {!selectedId&&<>
   <div className="review-toolbar"><div className="segmented" aria-label="Review period">{(['weekly','monthly'] as const).map(v=><button key={v} className={kind===v?'selected':''} onClick={()=>changeKind(v)}>{v==='weekly'?'Weekly':'Monthly'}</button>)}</div>
   {role!=='viewer'&&<div className="review-transfer-controls"><label className="field"><span>Period starts</span><input type="date" value={start} onChange={e=>setStart(e.target.value)}/></label><button className="secondary" disabled={busy||data.review_setup_missing} onClick={()=>void exportPacket()}><Download size={16}/>Export review packet</button><label className={'secondary review-import '+(busy?'disabled':'')}><Upload size={16}/>Import review<input aria-label="Import review JSON" type="file" accept=".json,application/json" disabled={busy||data.review_setup_missing} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void importPacket(file);}}/></label></div>}</div>
   <div className="review-history">{history.map(r=><button className="review-history-row" key={r.id} onClick={()=>select(r.id)}><span className="review-history-icon"><FileText size={21}/></span><span className="grow"><strong>{r.title}</strong><small>{dateLabel(r.period_start)} - {dateLabel(r.period_end)}</small><span className="review-excerpt">{r.overview}</span></span><ChevronRight size={18}/></button>)}</div>
   {!history.length&&<Empty title={data.review_setup_missing?'Review setup needs the database update':'No '+kind+' reviews yet'}/>}
  </>}
  {detail&&<article className="review-detail"><header><span className="badge">{detail.kind==='weekly'?'Weekly':'Monthly'}{preview?' - Local preview':''}</span><h2 className="review-title">{detail.title}</h2><p className="muted">{dateLabel(detail.period_start)} - {dateLabel(detail.period_end)}</p><div className="review-timestamps"><span>Snapshot {new Date(detail.snapshot_generated_at).toLocaleString('en-US',{timeZone:timezone})}</span><span>Delivered {new Date(detail.saved_at).toLocaleString('en-US',{timeZone:timezone})}</span></div>{(data.reviews??[]).filter(r=>r.report_key===detail.report_key).length>1&&<label className="field review-revision"><span>Revision</span><select value={detail.id} onChange={e=>select(e.target.value)}>{(data.reviews??[]).filter(r=>r.report_key===detail.report_key).sort((a,b)=>b.revision-a.revision).map(r=><option key={r.id} value={r.id}>Revision {r.revision}</option>)}</select></label>}</header>
   {detail.warnings.length>0&&<section className="review-data-notes"><h3>Data to keep in mind</h3><ul>{detail.warnings.map((w,i)=><li key={i}>{w}</li>)}</ul></section>}
   <section className="review-section review-overview"><h2>Overview</h2><p>{detail.overview}</p></section>
   {entries('What went well',detail.packet.wins)}{entries('Needs attention',detail.packet.concerns)}
   {detail.packet.stretch_plan.length>0&&<section className="review-section"><h2>Make things stretch</h2>{detail.packet.stretch_plan.map((s,i)=><div className="review-entry" key={i}><h3>{s.action}</h3><p>{s.tradeoff}</p>{s.savings_cents!==null&&<small>Estimated savings {money(s.savings_cents,true)} {s.savings_period==='once'?'one time':'per '+s.savings_period.replace('ly','')}</small>}{s.evidence_ids.length>0&&<small className="muted">Evidence: {s.evidence_ids.join(', ')}</small>}</div>)}</section>}
   {entries('Coming up',detail.packet.upcoming_priorities)}{entries('Following through',detail.packet.follow_through)}
   {detail.packet.tasks.length>0&&<section className="review-section"><h2><CheckCheck size={18}/>Next steps</h2>{detail.packet.tasks.map(t=>{const link=detail.task_links.find(l=>l.task_key===t.task_key);const current=data.tasks.find(v=>v.id===link?.task_id);return <div className="review-entry" key={t.task_key}><h3>{t.title}</h3><small className="muted">{t.assignee}{t.due_date?' - '+dateLabel(t.due_date):''} - {t.basis==='agreed'?'Agreed in discussion':'New suggestion'}</small>{t.notes&&<p>{t.notes}</p>}<small>{current?current.status:link?.outcome==='terminal'?'Already completed or dismissed':link?.outcome==='deleted'?'Previously deleted':'Not linked'}</small></div>;})}</section>}
   {detail.packet.assumptions.length>0&&<section className="review-section"><h2>Assumptions</h2><ul>{detail.packet.assumptions.map((s,i)=><li key={i}>{s}</li>)}</ul></section>}
   {detail.packet.missing_information.length>0&&<section className="review-section"><h2>Still unknown</h2><ul>{detail.packet.missing_information.map((s,i)=><li key={i}>{s}</li>)}</ul></section>}
   {detail.packet.evidence.length>0&&<section className="review-section"><h2>Evidence & sources</h2>{detail.packet.evidence.map(e=><div className="review-entry" key={e.id}><h3>{e.id}</h3><p>{e.summary}</p><small className="muted">{e.source.replaceAll('_',' ')} - {e.confidence} confidence - {e.reference}{e.observed_at?' - '+new Date(e.observed_at).toLocaleString('en-US',{timeZone:timezone}):''}</small>{e.url&&<a href={e.url} target="_blank" rel="noopener noreferrer">Source<ArrowUpRight size={14}/></a>}</div>)}</section>}
  </article>}
 </div>;
}
