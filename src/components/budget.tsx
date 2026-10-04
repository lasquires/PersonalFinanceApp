'use client';
import { useState } from 'react';
import { ArrowUpRight, Pencil, Plus, RotateCcw } from 'lucide-react';
import { budgetRows, cents, money } from '@/lib/finance';
import type { BudgetRow, Snapshot } from '@/lib/types';
import { Field, FormError, Modal, Submit } from './ui';
export type Save = (action: string, payload: Record<string, unknown>) => Promise<void>;

export function CategoryBar({ row, onClick }: { row: BudgetRow; onClick?: () => void }) {
  const available = row.budget + row.carried;
  const percent = Math.min(100, Math.max(0, available > 0 ? row.spent / available * 100 : row.spent > 0 ? 100 : 0));
  return <button className="category-row" onClick={onClick} aria-label={`View ${row.name} purchases`}>
    <span className="category-identity"><span className="category-name"><i style={{background:row.color}}/>{row.name}{row.rollover && <RotateCcw size={12}/>}</span><span className="category-detail">{money(row.spent)} of {money(available)} spent</span></span>
    <span className="category-meter" aria-hidden="true"><span style={{width:percent + '%',background:row.remaining < 0 ? 'var(--red)' : row.color}}/></span>
    <strong className={row.remaining < 0 ? 'negative' : ''}>{money(row.remaining)}</strong><ArrowUpRight size={14}/>
  </button>;
}

export function Budget({ data, month, save, navigate }: { data: Snapshot; month: string; save: Save; navigate: (tab: string, categoryId?: string) => void }) {
  const [editing, setEditing] = useState<BudgetRow | 'new' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const rows = budgetRows(data, month);
  const flexible = rows.filter(category => category.group === 'flexible');
  return <>
    <div className="section-heading"><div><h2>This month's budget</h2><p className="muted">{money(flexible.reduce((total, category) => total + category.remaining, 0))} available for everyday spending</p></div><button className="secondary" onClick={() => {setEditing('new');setError('');}}><Plus size={16}/>Category</button></div>
    {(['flexible','fixed','business'] as const).map(group => <section className="budget-section" key={group}>
      <div className="section-heading"><h3>{group === 'flexible' ? 'Everyday spending' : group === 'fixed' ? 'Fixed & recurring' : 'Rova / business'}</h3><span className="muted small">{money(rows.filter(row => row.group === group).reduce((total, row) => total + row.budget, 0))} / month</span></div>
      <div className="budget-table"><div className="budget-table-head"><span>Category</span><span>Budget</span><span>Spent</span><span>Remaining</span><span/></div>
        {rows.filter(row => row.group === group).map(row => <div className="budget-row-container" key={row.id}>
          <button className="budget-table-row" aria-label={`View ${row.name} purchases`} onClick={() => navigate('Transactions', row.id)}><span className="category-name"><i style={{background:row.color}}/><span>{row.name}{row.rollover && <small className="muted">{money(row.carried)} rolled forward</small>}</span></span><span>{money(row.budget)}</span><span>{money(row.spent)}</span><strong className={row.remaining < 0 ? 'negative' : ''}>{money(row.remaining)}</strong></button>
          <button className="icon-btn" title={`Edit ${row.name} budget`} aria-label={`Edit ${row.name} budget`} onClick={() => {setEditing(row);setError('');}}><Pencil size={15}/></button>
        </div>)}
      </div>
    </section>)}
    {editing && <Modal title={editing === 'new' ? 'Add category' : editing.name} close={() => setEditing(null)}><form onSubmit={async event => {
      event.preventDefault();const form = new FormData(event.currentTarget);setBusy(true);setError('');
      try {
        const amount = cents(String(form.get('amount')));
        if (editing === 'new') await save('category', {id:crypto.randomUUID(),name:form.get('name'),group:form.get('group'),monthly_cents:amount,rollover:form.get('rollover') === 'on',start_month:month,color:'#548a78'});
        else if (form.get('scope') === 'month') await save('budget', {category_id:editing.id,month,amount_cents:amount});
        else { const category = data.categories.find(value => value.id === editing.id)!; await save('category', {...category,monthly_cents:amount}); }
        setEditing(null);
      } catch (failure) { setError((failure as Error).message); } finally {setBusy(false);}
    }}>
      {editing === 'new' && <><Field label="Name"><input name="name" required maxLength={100}/></Field><Field label="Group"><select name="group"><option value="flexible">Everyday spending</option><option value="fixed">Fixed & recurring</option><option value="business">Business</option></select></Field><label className="check"><input type="checkbox" name="rollover"/>Roll unused money into next month</label></>}
      <Field label="Monthly amount ($)"><input name="amount" type="number" step="0.01" min="0" max="100000000" required defaultValue={editing === 'new' ? '' : editing.budget / 100}/></Field>
      {editing !== 'new' && <Field label="Apply to"><select name="scope"><option value="month">This month only</option><option value="default">Default monthly amount</option></select></Field>}
      <FormError error={error}/><Submit busy={busy}/>
    </form></Modal>}
  </>;
}
