'use client';
import { useState } from 'react';
import { Check, Link2, Plus, Undo2 } from 'lucide-react';
import { money } from '@/lib/finance';
import { eligibleMatches,likelyMatches } from '@/lib/reconciliation';
import type { Snapshot,Transaction } from '@/lib/types';
import type { Save } from './budget';
import { Empty,FormError,Modal } from './ui';

export function ImportReview({data,rows,save,onEdit,canWrite}:{data:Snapshot;rows:Transaction[];save:Save;onEdit:(t:Transaction)=>void;canWrite:boolean}){
 const [matching,setMatching]=useState<Transaction|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const current=matching?data.transactions.find(t=>t.id===matching.id):undefined;
 const candidates=current?eligibleMatches(current,data.transactions,data.match_rejections):[];
 async function act(action:string,imported:Transaction,manualId?:string){setBusy(true);setError('');try{await save(action,{import_id:imported.id,manual_id:manualId});setMatching(null);}catch(failure){setError((failure as Error).message);}finally{setBusy(false);}}
 return <><FormError error={!matching?error:''}/><div className="import-list">{rows.map(t=>{
  const likely=likelyMatches(t,data.transactions,data.match_rejections);
  const linked=data.transactions.find(m=>m.id===t.matched_manual_id);
  const isPurchase=t.kind==='expense'&&!t.excluded&&t.currency==='USD';
  const status=t.matched_manual_id?'Matched':!isPurchase?t.excluded?'Excluded':t.kind==='transfer'?'Transfer':t.kind==='income'?'Income':'Non-USD':likely.length?'Possible match found':'No likely match found';
  const budget=t.matched_manual_id?'Already recorded':!isPurchase?'Not counted':t.budget_state==='held'?'Paused for matching':t.budget_state==='unbudgeted'||!t.category_id&&!t.splits.length?'Not budgeted':t.user_modified===false?'Automatically budgeted':'In budget';
  return <article className="import-item" key={t.id}>
   <div className="import-identity"><span className="merchant-avatar">{t.merchant[0]}</span><div className="grow"><strong>{t.merchant}</strong><small>{t.date} · {data.accounts.find(a=>a.id===t.account_id)?.name??(t.source==='csv'?'CSV import':'Bank import')}{t.pending?' · Pending':''}</small></div><strong>{t.amount_cents<0?'+':''}{t.currency==='USD'?money(Math.abs(t.amount_cents),true):`${Math.abs(t.amount_cents/100).toFixed(2)} ${t.currency}`}</strong></div>
   <div className="import-status"><span className={t.matched_manual_id?'positive':likely.length?'amber-text':'muted'}>{t.matched_manual_id&&<Check size={14}/>} {status}</span><span>{budget}</span></div>
   {linked&&<button className="matched-purchase" onClick={()=>onEdit(linked)}><Link2 size={14}/>{linked.merchant} · {linked.date} · {money(linked.amount_cents,true)}</button>}
   {t.matched_manual_id&&t.needs_review&&<p className="form-error">Needs attention: the bank amount or currency differs from your recorded purchase.</p>}
   {canWrite&&<div className="import-actions">{t.matched_manual_id?<button className="text-btn" disabled={busy} onClick={()=>act('unmatch_import',t)}><Undo2 size={15}/>Undo match</button>:<><button className="text-btn" disabled={busy||!isPurchase} onClick={()=>{setMatching(t);setError('');}}><Link2 size={15}/>Match existing purchase</button><button className="text-btn" disabled={busy} onClick={()=>onEdit(t)}><Plus size={15}/>{budget==='In budget'?'Edit category':'Add to budget'}</button>{likely.length===1&&<button className="text-btn" disabled={busy} onClick={()=>act('separate_import',t,likely[0].id)}>Different purchase</button>}</>}</div>}
  </article>;
 })}</div>{!rows.length&&<Empty title="No bank imports in this view"/>}
 {matching&&<Modal title="Match existing purchase" sheet close={()=>{if(!busy)setMatching(null);}}><div className="matching-list">{candidates.map(t=><div key={t.id}><button className="matching-option" disabled={busy} onClick={()=>act('match_import',current!,t.id)}><span className="grow"><strong>{t.merchant}</strong><small>{t.date} · {t.splits.length?'Split purchase':data.categories.find(c=>c.id===t.category_id)?.name}</small></span><strong>{money(t.amount_cents,true)}</strong><Link2 size={16}/></button><button className="text-btn" disabled={busy} onClick={()=>act('separate_import',current!,t.id)}>Different purchase</button></div>)}</div>{!candidates.length&&<Empty title="No eligible manual purchases"/>}<FormError error={error}/></Modal>}
 </>;
}
