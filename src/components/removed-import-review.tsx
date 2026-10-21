'use client';
import { useState } from 'react';
import { money } from '@/lib/finance';
import type { Snapshot, Transaction } from '@/lib/types';
import type { Save } from './budget';
import { Empty, Field, FormError, Modal, Submit } from './ui';

export function RemovedImportReview({data,rows,save,canWrite}:{data:Snapshot;rows:Transaction[];save:Save;canWrite:boolean}) {
  const [selected,setSelected]=useState<Transaction|null>(null);
  const [resolution,setResolution]=useState<'keep'|'dismiss'>('keep');
  const [category,setCategory]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  function open(transaction:Transaction,next:'keep'|'dismiss') {
    setSelected(transaction);setResolution(next);setCategory(transaction.category_id??data.categories[0]?.id??'');setError('');
  }
  return <>
    <FormError error={!selected?error:''}/>
    <div className="import-list">{rows.map(transaction=><article className="import-item" key={transaction.id}>
      <div className="import-identity"><span className="merchant-avatar">{transaction.merchant[0]}</span><div className="grow"><strong>{transaction.merchant}</strong><small>{transaction.date} · {data.accounts.find(account=>account.id===transaction.account_id)?.name??'Bank account'}</small></div><strong>{money(transaction.amount_cents,true)}</strong></div>
      <div className="import-status"><span className="amber-text">No longer in bank feed</span><span>Not counted in budget</span></div>
      {canWrite&&<div className="import-actions"><button className="primary" onClick={()=>open(transaction,'keep')}>Keep purchase</button><button className="secondary" onClick={()=>open(transaction,'dismiss')}>Was reversed</button></div>}
    </article>)}</div>
    {!rows.length&&<Empty title="No bank feed changes to review"/>}
    {selected&&<Modal title={resolution==='keep'?'Keep this purchase?':'Mark as reversed?'} sheet close={()=>{if(!busy)setSelected(null);}}>
      <p>{selected.merchant} · {selected.date} · {money(selected.amount_cents,true)}</p>
      <p className="muted">{resolution==='keep'?'This adds the purchase to your budget once. The removed bank record stays in history.':'This leaves the purchase out of your budget and clears the alert.'}</p>
      <form onSubmit={async event=>{event.preventDefault();setBusy(true);setError('');try{await save('resolve_removed_import',{import_id:selected.id,resolution,category_id:resolution==='keep'?category:null});setSelected(null);}catch(failure){setError((failure as Error).message);}finally{setBusy(false);}}}>
        {resolution==='keep'&&<Field label="Category"><select value={category} required onChange={event=>setCategory(event.target.value)}>{data.categories.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>}
        <FormError error={error}/><Submit busy={busy} label={resolution==='keep'?'Keep purchase':'Confirm reversal'}/>
      </form>
    </Modal>}
  </>;
}

