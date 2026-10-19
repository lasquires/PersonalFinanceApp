'use client';
import { useState } from 'react';
import { ClipboardCopy, ClipboardPaste, Trash2 } from 'lucide-react';
import { makeCategoryInstructions, parseCategoryPlan, type CategoryPlan } from '@/lib/category-plan';
import { money } from '@/lib/finance';
import type { Snapshot } from '@/lib/types';
import { Field, FormError, Modal } from './ui';

export function CategoryPlanEditor({ data, apply, close }: { data: Snapshot; apply: (plan: CategoryPlan) => Promise<void>; close: () => void }) {
  const [reply, setReply] = useState('');
  const [plan, setPlan] = useState<CategoryPlan | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const instructions = makeCategoryInstructions(data.categories);
  const names = new Map(data.categories.map(category => [category.id, category.name]));
  const finalNames = new Map(names);
  plan?.changes.forEach(change => { if (change.action === 'update' && change.name) finalNames.set(change.id, change.name); });
  const deletes = plan?.changes.filter(change => change.action === 'delete') ?? [];
  return <Modal title="ChatGPT category plan" close={close}>
    <p className="muted small">Copy these instructions into ChatGPT. It will return a copyable JSON code box; paste that whole box below. Review every change before applying it.</p>
    <button className="secondary" type="button" onClick={async () => { try { await navigator.clipboard.writeText(instructions); setCopied(true); setError(''); } catch { setError('Clipboard unavailable. Select and copy the instructions below.'); } }}><ClipboardCopy size={16}/>{copied ? 'Instructions copied' : 'Copy instructions'}</button>
    <details className="category-plan-instructions"><summary>View instructions</summary><textarea aria-label="ChatGPT instructions" readOnly value={instructions}/></details>
    <Field label="Paste ChatGPT's JSON box"><textarea className="category-plan-reply" value={reply} onChange={event => { setReply(event.target.value); setPlan(null); setConfirmed(false); setError(''); }} placeholder='{"version":1,"changes":[...]}' spellCheck={false}/></Field>
    <button className="secondary" type="button" disabled={!reply.trim() || busy} onClick={() => { try { setPlan(parseCategoryPlan(reply, data.categories)); setError(''); } catch (failure) { setPlan(null); setError((failure as Error).message); } }}><ClipboardPaste size={16}/>Preview changes</button>
    {plan && <div className="category-plan-preview"><h3>Review {plan.changes.length} changes</h3><ul>{plan.changes.map((change, index) => <li key={index}>
      {change.action === 'add' ? <><strong>Add {change.name}</strong><span>{money(change.monthly_cents)} monthly · {change.group}{change.rollover ? ' · rolls over' : ''}</span></>
      : change.action === 'update' ? <><strong>Update {names.get(change.id)}</strong><span>{change.name && change.name !== names.get(change.id) ? `Rename to ${change.name}. ` : ''}{change.monthly_cents !== undefined ? `${money(change.monthly_cents)} monthly. ` : ''}{change.group ? `Group: ${change.group}. ` : ''}{change.rollover !== undefined ? `Rollover: ${change.rollover ? 'on' : 'off'}.` : ''}</span></>
      : <><strong><Trash2 size={14}/>Delete {change.confirm_name}</strong><span>Move its purchases, splits, tasks, and remembered merchants to {finalNames.get(change.replacement_id)}. {change.reason}</span></>}
    </li>)}</ul>
      {deletes.length > 0 && <label className="check category-plan-confirm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)}/><span>I understand that {deletes.length} named {deletes.length === 1 ? 'category' : 'categories'} will be deleted and their history moved as shown.</span></label>}
      <button className="primary" type="button" disabled={busy || (deletes.length > 0 && !confirmed)} onClick={async () => { setBusy(true); setError(''); try { await apply(plan); close(); } catch (failure) { setError((failure as Error).message); } finally { setBusy(false); } }}>{busy ? 'Applying...' : 'Apply category plan'}</button>
    </div>}
    <FormError error={error}/>
  </Modal>;
}
