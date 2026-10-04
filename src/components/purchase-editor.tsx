'use client';
import { useState } from 'react';
import { Split as SplitIcon, Trash2, X } from 'lucide-react';
import { cents,money,today,validateSplits } from '@/lib/finance';
import type { Snapshot,Transaction } from '@/lib/types';
import type { Save } from './budget';
import { Field,FormError,Modal,Submit } from './ui';

export const blankPurchase=(categoryId:string|null=null):Transaction=>({id:crypto.randomUUID(),merchant:'',date:today(),amount_cents:0,category_id:categoryId,account_id:null,kind:'expense',excluded:false,pending:false,removed:false,note:'',splits:[],source:'manual',currency:'USD',needs_review:false,budget_state:'budgeted'});

export function PurchaseEditor({transaction:t,data,save,close,readOnly=false}:{transaction:Transaction;data:Snapshot;save:Save;close:()=>void;readOnly?:boolean}) {
 const [splits,setSplits]=useState(t.splits.map(s=>({category_id:s.category_id,amount:String(s.amount_cents/100)})));
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const exists=data.transactions.some(row=>row.id===t.id),manual=t.source==='manual';
 return <Modal title={exists ? manual?'Edit purchase':'Bank purchase' : 'Add purchase'} sheet close={()=>{if(!busy)close();}}>
  <form className="purchase-form" onSubmit={async e=>{
   e.preventDefault();const f=new FormData(e.currentTarget);setBusy(true);setError('');
   try{
    const amount=manual?cents(String(f.get('amount'))):t.amount_cents;
    const parsed=splits.map(s=>({category_id:s.category_id,amount_cents:cents(s.amount)}));
    if(parsed.some(s=>!s.category_id))throw new Error('Choose a category for every split.');
    validateSplits(amount,parsed);
    const kind=String(f.get('kind')),category=String(f.get('category')??'')||null,excluded=f.get('excluded')==='on';
    if(kind==='expense'&&!excluded&&!category&&!parsed.length)throw new Error('Choose a category to add this purchase to your budget.');
    await save('transaction',{...t,merchant:manual?f.get('merchant'):t.merchant,date:manual?f.get('date'):t.date,account_id:manual?(f.get('account')||null):t.account_id,amount_cents:amount,category_id:parsed.length?null:category,kind,excluded,note:f.get('note'),splits:parsed,needs_review:false,remember_category:f.get('remember_category')==='on'});
    close();
   }catch(failure){setError((failure as Error).message);}finally{setBusy(false);}
  }}>
   <fieldset className="purchase-fields" disabled={busy||readOnly}>
    {manual?<><Field label="Merchant"><input name="merchant" required maxLength={300} defaultValue={t.merchant} autoComplete="off"/></Field><div className="form-grid"><Field label="Date"><input name="date" type="date" required defaultValue={t.date}/></Field><Field label="Amount ($; negative for refund)"><input name="amount" type="number" inputMode="decimal" step="0.01" required defaultValue={exists?t.amount_cents/100:undefined}/></Field></div><Field label="Account"><select name="account" defaultValue={t.account_id??''}><option value="">Not specified</option>{data.accounts.map(a=><option key={a.id} value={a.id}>{a.name}{a.mask?' · '+a.mask:''}</option>)}</select></Field></>:<div className="transaction-summary"><strong>{money(t.amount_cents,true)}</strong><span>{t.merchant}<small>{t.date}{t.pending?' · Pending':''}</small></span></div>}
    <Field label="Type"><select name="kind" defaultValue={t.kind}><option value="expense">Purchase / refund</option><option value="transfer">Internal transfer / card payment</option><option value="income">Income / funding</option></select></Field>
    {!splits.length?<Field label="Category"><select name="category" defaultValue={t.category_id??''}><option value="">Uncategorized</option>{data.categories.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select></Field>:<div className="split-list">{splits.map((s,i)=><div className="split-row" key={i}><select aria-label={`Split ${i+1} category`} value={s.category_id} onChange={e=>setSplits(splits.map((x,j)=>j===i?{...x,category_id:e.target.value}:x))}><option value="">Category</option>{data.categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select><input aria-label={`Split ${i+1} amount`} type="number" inputMode="decimal" step="0.01" required value={s.amount} onChange={e=>setSplits(splits.map((x,j)=>j===i?{...x,amount:e.target.value}:x))}/><button type="button" className="icon-btn" aria-label={`Remove split ${i+1}`} onClick={()=>setSplits(splits.filter((_,j)=>j!==i))}><X size={16}/></button></div>)}</div>}
    <button className="text-btn" type="button" onClick={()=>setSplits(splits.length?[...splits,{category_id:'',amount:''}]:[{category_id:t.category_id??'',amount:''},{category_id:'',amount:''}])}><SplitIcon size={15}/>{splits.length?'Add split':'Split transaction'}</button>
    {splits.length>0&&<button className="text-btn" type="button" onClick={()=>setSplits([])}>Remove all splits</button>}
    <Field label="Note"><textarea name="note" defaultValue={t.note}/></Field>
    {!splits.length&&<label className="check"><input name="remember_category" type="checkbox"/>Remember category for future matches</label>}
    <label className="check"><input name="excluded" type="checkbox" defaultChecked={t.excluded}/>Exclude from budget</label>
    {t.currency!=='USD'&&<p className="form-error">Non-USD transactions are excluded until you record a USD equivalent manually.</p>}
   </fieldset>
   <FormError error={error}/>
   {!readOnly&&<div className="purchase-actions"><Submit busy={busy}/>{exists&&t.source!=='plaid'&&<button className="text-btn danger" type="button" disabled={busy} onClick={async()=>{if(!confirm('Remove this transaction from the budget?'))return;setBusy(true);try{await save('delete_transaction',{id:t.id});close();}catch(failure){setError((failure as Error).message);}finally{setBusy(false);}}}><Trash2 size={16}/>Remove</button>}</div>}
  </form>
 </Modal>;
}
