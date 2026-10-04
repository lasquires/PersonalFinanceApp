'use client';
import { useEffect,useState } from 'react';
import { Copy,Download,KeyRound,RefreshCw,ShieldOff,X } from 'lucide-react';
import { museCourierPrompt } from '@/lib/reviews/handoff';
import { downloadReviewFile } from '@/lib/reviews/download';
import { FormError,Modal } from './ui';
type Status={active:boolean;created_at:string|null;last_used_at:string|null};
export function ReviewCourierSettings({preview,role}:{preview:boolean;role:'admin'|'member'|'viewer'}){
 const [status,setStatus]=useState<Status|null>(null);const [token,setToken]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [message,setMessage]=useState('');const [confirm,setConfirm]=useState<'replace'|'revoke'|null>(null);
 useEffect(()=>{if(preview||role!=='admin')return;let active=true;void fetch('/api/reviews/courier-token',{cache:'no-store'}).then(async r=>{const body=await r.json();if(!r.ok)throw new Error(body.error??'Key status could not be loaded.');if(active)setStatus(body);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[preview,role]);
 useEffect(()=>{if(!token)return;const timer=setTimeout(()=>setToken(''),300000);return()=>clearTimeout(timer);},[token]);
 if(role!=='admin')return null;
 const change=async(operation:'replace'|'revoke')=>{setBusy(true);setConfirm(null);setToken('');setError('');setMessage('');try{const response=await fetch('/api/reviews/courier-token',{method:operation==='replace'?'POST':'DELETE'});const body=await response.json();if(!response.ok)throw new Error(body.error??'Key could not be updated.');if(operation==='replace'){setToken(body.token);setStatus({active:true,created_at:new Date().toISOString(),last_used_at:null});}else{setStatus({active:false,created_at:null,last_used_at:null});setMessage('Review courier key revoked.');}}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 return <section className="settings-section review-courier-settings"><div className="section-heading"><h3><KeyRound size={17}/>Review courier</h3><span className="badge">{preview?'Local preview':status?.active?'Key active':'No active key'}</span></div>
  {status?.created_at&&<p className="small muted">Created {new Date(status.created_at).toLocaleString()}<br/>{status.last_used_at?'Last used '+new Date(status.last_used_at).toLocaleString():'Not used yet'}</p>}
  <div className="review-key-actions"><button className="secondary" disabled={busy||preview} onClick={()=>status?.active?setConfirm('replace'):void change('replace')}><KeyRound size={15}/>{status?.active?'Replace courier key':'Create courier key'}</button><button className="secondary" disabled={busy||preview||!status?.active} onClick={()=>setConfirm('revoke')}><ShieldOff size={15}/>Revoke key</button><button className="secondary" onClick={()=>downloadReviewFile('muse-financial-review-instructions.txt',museCourierPrompt())}><Download size={15}/>Muse instructions</button></div>
  {token&&<div className="review-new-key"><label className="field"><span>New review courier key</span><input type="password" readOnly autoComplete="off" value={token}/></label><button className="secondary" onClick={()=>void navigator.clipboard.writeText(token).then(()=>setMessage('Key copied. Secure secret name: FINANCE_REVIEW_TOKEN.')).catch(()=>setError('Clipboard access failed.'))}><Copy size={15}/>Copy key</button><button className="icon-btn" title="Dismiss key" aria-label="Dismiss key" onClick={()=>setToken('')}><X size={17}/></button></div>}
  {message&&<p className="small" role="status">{message}</p>}<FormError error={error}/>
  {confirm&&<Modal title={confirm==='replace'?'Replace courier key?':'Revoke courier key?'} close={()=>setConfirm(null)}><p>The current review key will stop working immediately. SNAP updates are unaffected.</p><div className="dialog-actions"><button className="secondary" onClick={()=>setConfirm(null)}>Cancel</button><button className="primary" onClick={()=>void change(confirm)}>{confirm==='replace'?<RefreshCw size={16}/>:<ShieldOff size={16}/>}Confirm {confirm}</button></div></Modal>}
 </section>;
}
