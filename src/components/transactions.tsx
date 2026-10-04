'use client';
import { useEffect,useState } from 'react';
import { Plus,Upload,Search } from 'lucide-react';
import type { Snapshot,Transaction } from '@/lib/types';
import { money,monthLabel } from '@/lib/finance';
import { countsInBudget } from '@/lib/reconciliation';
import { csvTransactions,parseCsv,type CsvData } from '@/lib/csv';
import { Empty,Field,FormError,Modal,Submit } from './ui';
import type { Save } from './budget';
import { blankPurchase,PurchaseEditor } from './purchase-editor';
import { ImportReview } from './import-review';

export function Transactions({data,save,month,initialFilter='all',initialAccount='all',canWrite=true}:{data:Snapshot;save:Save;month:string;initialFilter?:string;initialAccount?:string;canWrite?:boolean}) {
 const [search,setSearch]=useState(''),[filter,setFilter]=useState(initialFilter),[account,setAccount]=useState(initialAccount);
 const [view,setView]=useState<'purchases'|'imports'>(initialFilter==='review'?'imports':'purchases');
 const [allTime,setAllTime]=useState(false),[editing,setEditing]=useState<Transaction|null>(null);
 useEffect(()=>{setAllTime(false);},[month]);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[csv,setCsv]=useState<CsvData|null>(null);
 const [importMap,setImportMap]=useState({date:'',merchant:'',amount:'',sign:'positive',account:''});
 const [importRows,setImportRows]=useState<Record<string,unknown>[]>([]),[limit,setLimit]=useState(100),[progress,setProgress]=useState('');
 const rows=data.transactions.filter(t=>!t.removed&&(allTime||t.date.startsWith(month.slice(0,7)))&&
  (view==='imports'?t.source!=='manual':t.source==='manual'||countsInBudget(t))&&
  (!search||`${t.merchant} ${t.note}`.toLowerCase().includes(search.toLowerCase()))&&(account==='all'||t.account_id===account)&&
  (filter==='all'||(filter==='review'?t.needs_review||t.budget_state==='held'||t.budget_state==='unbudgeted':filter==='pending'?t.pending:filter==='transfers'?t.kind==='transfer':t.category_id===filter||t.splits.some(s=>s.category_id===filter)))).sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id));
 const add=()=>setEditing(blankPurchase(data.categories.some(c=>c.id===filter)?filter:null));
 return <>
  <div className="section-heading"><h2>Transactions</h2>{canWrite&&<div className="button-group"><label className="secondary file-button"><Upload size={16}/><span>Import CSV</span><input aria-label="Import CSV" type="file" accept=".csv,text/csv" onChange={async e=>{
   setError('');try{const file=e.target.files?.[0];if(!file)return;if(file.size>5000000)throw new Error('Choose a CSV smaller than 5 MB.');const parsed=parseCsv(await file.text());setCsv(parsed);setImportRows([]);setProgress('');setImportMap({date:parsed.headers.find(h=>/date/i.test(h))??parsed.headers[0],merchant:parsed.headers.find(h=>/merchant|description|name/i.test(h))??parsed.headers[0],amount:parsed.headers.find(h=>/amount/i.test(h))??parsed.headers[0],sign:'positive',account:''});}catch(failure){setError((failure as Error).message);}e.target.value='';
  }}/></label><button className="primary" onClick={add}><Plus size={16}/>Add</button></div>}</div>
  <div className="transaction-views segmented" role="group" aria-label="Transaction view"><button className={view==='purchases'?'selected':''} aria-pressed={view==='purchases'} onClick={()=>{setView('purchases');if(filter==='review')setFilter('all');setLimit(100);}}>Purchases</button><button className={view==='imports'?'selected':''} aria-pressed={view==='imports'} onClick={()=>{setView('imports');setLimit(100);}}>Bank imports</button></div>
  <div className="transaction-range segmented" role="group" aria-label="Transaction dates"><button className={!allTime?'selected':''} aria-pressed={!allTime} onClick={()=>setAllTime(false)}>{monthLabel(month)}</button><button className={allTime?'selected':''} aria-pressed={allTime} onClick={()=>setAllTime(true)}>All time</button></div>
  <div className="transaction-filters"><label className="search-box"><Search size={17}/><input aria-label="Search transactions" placeholder="Search activity" value={search} onChange={e=>setSearch(e.target.value)}/></label><select aria-label="Filter transactions" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All activity</option><option value="review">Needs review</option><option value="pending">Pending</option><option value="transfers">Transfers</option>{data.categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select><select aria-label="Filter account" value={account} onChange={e=>setAccount(e.target.value)}><option value="all">All accounts</option>{data.accounts.map(a=><option key={a.id} value={a.id}>{a.name} · {a.member}</option>)}</select></div>
  <p className="transaction-count muted">{rows.length} {view==='imports'?'bank records':'transactions'}</p><FormError error={!csv?error:''}/>
  {view==='imports'?<ImportReview data={data} rows={rows.slice(0,limit)} save={save} onEdit={setEditing} canWrite={canWrite}/>:<><div className="transaction-list">{rows.slice(0,limit).map(t=><button key={t.id} className="transaction-row" onClick={()=>setEditing(t)}><span className="merchant-avatar">{t.merchant[0]}</span><span className="transaction-description"><strong>{t.merchant}</strong><small>{t.date} · {data.accounts.find(a=>a.id===t.account_id)?.name??'Manual'}{data.accounts.find(a=>a.id===t.account_id)?.member?' · '+data.accounts.find(a=>a.id===t.account_id)?.member:''}</small></span><span className="transaction-category">{t.kind==='transfer'?'Transfer':t.kind==='income'?'Income':t.excluded?'Excluded':t.splits.length?'Split across '+t.splits.length:data.categories.find(c=>c.id===t.category_id)?.name??'Uncategorized'}{t.needs_review&&<small className="amber-text">Needs review</small>}</span><span className="transaction-amount"><strong className={t.amount_cents<0?'positive':''}>{t.amount_cents<0?'+':''}{t.currency==='USD'?money(Math.abs(t.amount_cents),true):`${Math.abs(t.amount_cents/100).toFixed(2)} ${t.currency}`}</strong>{t.pending&&<small className="badge">Pending</small>}</span></button>)}</div>{!rows.length&&<Empty title={data.transactions.length?'No matching activity':'No transactions yet'} action={canWrite?'Add purchase':undefined} onAction={add}/>}</>}
  {rows.length>limit&&<button className="secondary" onClick={()=>setLimit(n=>n+100)}>Show more</button>}
  {editing&&<PurchaseEditor key={editing.id} transaction={editing} data={data} save={save} readOnly={!canWrite} close={()=>setEditing(null)}/>}
  {csv&&<Modal title="Import bank CSV" close={()=>{if(!busy)setCsv(null);}}><form onSubmit={async e=>{
   e.preventDefault();setError('');setBusy(true);
   try{if(!importRows.length)setImportRows(await csvTransactions(csv,importMap));else{const existing=new Set(data.transactions.map(t=>t.id));let count=0;for(const row of importRows){if(existing.has(String(row.id)))continue;await save('transaction',row);existing.add(String(row.id));setProgress(`${++count} saved`);}setCsv(null);setView('imports');setFilter('all');setAccount('all');}}
   catch(failure){setError((failure as Error).message);}finally{setBusy(false);}
  }}>{!importRows.length?<><p className="muted">{csv.rows.length} rows found</p>{(['date','merchant','amount'] as const).map(key=><Field key={key} label={key==='date'?'Date column':key==='merchant'?'Merchant / description column':'Amount column'}><select value={importMap[key]} onChange={e=>setImportMap({...importMap,[key]:e.target.value})}>{csv.headers.map(h=><option key={h}>{h}</option>)}</select></Field>)}<Field label="Purchases in this file are"><select value={importMap.sign} onChange={e=>setImportMap({...importMap,sign:e.target.value})}><option value="positive">Positive amounts</option><option value="negative">Negative amounts</option></select></Field><Field label="Account label (use the same label for future imports)"><input required value={importMap.account} onChange={e=>setImportMap({...importMap,account:e.target.value})} placeholder="Luke checking"/></Field></>:<><p>{importRows.length} transactions ready</p>{importRows.slice(0,5).map(r=><div className="history-row" key={String(r.id)}><span>{String(r.merchant)}<small>{String(r.date)}</small></span><strong>{money(Number(r.amount_cents),true)}</strong></div>)}<button type="button" className="text-btn" disabled={busy} onClick={()=>setImportRows([])}>Change column mapping</button></>}<FormError error={error}/>{progress&&<p role="status">{progress}</p>}<Submit busy={busy} label={importRows.length?'Import transactions':'Preview import'}/></form></Modal>}
 </>;
}
