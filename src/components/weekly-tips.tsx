'use client';
import { Lightbulb, X } from 'lucide-react';
import type { MemberRole, Tip } from '@/lib/types';
import type { Save } from './budget';

export function WeeklyTips({tips,role,save,onError}:{tips:Tip[];role:MemberRole;save:Save;onError:(message:string)=>void}){
  const today=new Date().toISOString().slice(0,10);
  const active=tips.filter(tip=>tip.status==='active'&&(!tip.expires_at||tip.expires_at>=today)).sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(0,3);
  if(!active.length)return null;
  return <section className="weekly-tips"><div className="section-heading"><h2><Lightbulb size={18}/>Weekly tips</h2></div><div className="tips-list">{active.map(tip=><article className="tip-item" key={tip.id}><div className="grow"><strong>{tip.title}</strong><p>{tip.body}</p><small>{tip.origin==='assistant'?'ChatGPT':'Household'} · {new Date(tip.created_at).toLocaleDateString()}</small></div>{role!=='viewer'&&<button className="icon-btn" aria-label={`Dismiss ${tip.title}`} title="Dismiss" onClick={()=>save('tip_status',{id:tip.id,status:'dismissed'}).catch(error=>onError(error.message))}><X size={16}/></button>}</article>)}</div></section>;
}
