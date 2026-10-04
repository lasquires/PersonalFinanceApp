import type { MatchRejection, Snapshot, Transaction } from './types';

export function countsInBudget(t: Transaction) {
  return !t.removed && !t.excluded && t.kind === 'expense' && t.currency === 'USD' &&
    !t.matched_manual_id && (t.budget_state === undefined || t.budget_state === 'budgeted');
}
export function merchantWords(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/).filter(word => word.length >= 4 && !['purchase','store','debit','card','payment'].includes(word));
}
export function similarMerchants(a: string,b: string) {
  const left=merchantWords(a), right=merchantWords(b);
  return a.trim().toLowerCase() === b.trim().toLowerCase() || left.some(word=>right.includes(word));
}
export function eligibleMatches(imported: Transaction, transactions: Transaction[], rejections: MatchRejection[] = []) {
  if (imported.source==='manual' || imported.removed || imported.excluded || imported.kind!=='expense' || imported.currency!=='USD' || imported.matched_manual_id) return [];
  const linked=new Set(transactions.filter(t=>!t.removed && t.matched_manual_id).map(t=>t.matched_manual_id));
  return transactions.filter(t=>t.source==='manual' && countsInBudget(t) && (t.category_id || t.splits.length) && !linked.has(t.id) && t.amount_cents===imported.amount_cents &&
    Math.abs(Date.parse(t.date)-Date.parse(imported.date)) <= 7*86400000 && (!t.account_id || !imported.account_id || t.account_id===imported.account_id) &&
    !rejections.some(r=>r.import_id===imported.id && r.manual_id===t.id)).sort((a,b)=>Math.abs(Date.parse(a.date)-Date.parse(imported.date))-Math.abs(Date.parse(b.date)-Date.parse(imported.date)) || a.id.localeCompare(b.id));
}
export function likelyMatches(imported: Transaction, transactions: Transaction[], rejections: MatchRejection[] = []) {
  return eligibleMatches(imported,transactions,rejections).filter(t=>similarMerchants(imported.merchant,t.merchant));
}
export function savePreviewPurchase(data:Snapshot,purchase:Transaction,remember=false):Snapshot {
  const next=structuredClone(data),saved={...purchase,user_modified:true};
  const exists=next.transactions.some(t=>t.id===saved.id);
  const key=saved.merchant.trim().toLowerCase().replace(/\s+/g,' ');
  if(!exists&&saved.source!=='manual') {
    saved.category_id=next.preview_merchant_rules?.[key]??null;
    saved.user_modified=false;
  }
  saved.budget_state=saved.category_id||saved.splits.length?'budgeted':'unbudgeted';
  saved.needs_review=saved.source!=='manual'&&saved.kind==='expense'&&saved.budget_state==='unbudgeted';
  if(remember) {
    if(saved.kind!=='expense'||!saved.category_id||saved.splits.length)throw new Error('Choose a single purchase category to remember.');
    next.preview_merchant_rules={...next.preview_merchant_rules,[key]:saved.category_id};
  }
  next.transactions=[...next.transactions.filter(t=>t.id!==saved.id),saved];
  return reconcilePreview(next,'transaction',{});
}
export function reconcilePreview(data: Snapshot,action: string,payload: Record<string,unknown>): Snapshot {
  const next=structuredClone(data);
  next.match_rejections ??= [];
  const imported=next.transactions.find(t=>t.id===payload.import_id);
  if (['match_import','unmatch_import','separate_import'].includes(action)) {
    if (!imported || imported.source==='manual' || imported.removed) throw new Error('This bank import is no longer available.');
    if (action==='match_import') {
      if (!eligibleMatches(imported,next.transactions,next.match_rejections).some(t=>t.id===payload.manual_id)) throw new Error('Choose an eligible, unmatched manual purchase.');
      imported.matched_manual_id=String(payload.manual_id); imported.budget_state='matched'; imported.needs_review=false;
    } else if (action==='unmatch_import') {
      imported.matched_manual_id=null; imported.budget_state='unbudgeted'; imported.needs_review=true;
    } else {
      if (imported.matched_manual_id) throw new Error('Undo the match first.');
      const candidate=eligibleMatches(imported,next.transactions,next.match_rejections).find(t=>t.id===payload.manual_id);
      if (!candidate) throw new Error('Choose an eligible, unmatched manual purchase.');
      next.match_rejections.push({import_id:imported.id,manual_id:candidate.id});
      imported.budget_state=imported.category_id || imported.splits.length ? 'budgeted':'unbudgeted';
      imported.needs_review=imported.budget_state==='unbudgeted';
    }
  }
  for (const t of next.transactions.filter(t=>t.source!=='manual' && !t.removed)) {
    if (t.matched_manual_id) {
      const manual=next.transactions.find(m=>m.id===t.matched_manual_id);
      if (!manual || manual.removed || manual.excluded || manual.kind!=='expense') {t.matched_manual_id=null;t.budget_state='unbudgeted';t.needs_review=true;}
      else t.needs_review=manual.amount_cents!==t.amount_cents || manual.currency!==t.currency;
    } else if (likelyMatches(t,next.transactions,next.match_rejections).length) {
      if (t.budget_state==='budgeted' || t.budget_state===undefined) {t.budget_state='held';t.needs_review=true;}
    } else if (t.budget_state==='held') {
      t.budget_state=t.category_id || t.splits.length ? 'budgeted':'unbudgeted';
      t.needs_review=t.budget_state==='unbudgeted';
    }
  }
  return next;
}
