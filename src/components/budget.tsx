'use client';
import { useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ArrowUpRight, ClipboardPaste, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { budgetRows, cents, money } from '@/lib/finance';
import { sortBudgetRows, type BudgetSortDirection, type BudgetSortKey } from '@/lib/budget-sort';
import type { BudgetRow, Category, Snapshot } from '@/lib/types';
import { Field, FormError, Modal, Submit } from './ui';
import { CategoryPlanEditor } from './category-plan-editor';
import type { CategoryPlan } from '@/lib/category-plan';
export type Save = (action: string, payload: Record<string, unknown>) => Promise<void>;
type SortChoice = { key: BudgetSortKey; direction: BudgetSortDirection };
const defaultSort: SortChoice = { key: 'name', direction: 'asc' };

export function CategoryBar({ row, onClick, onAdd }: { row: BudgetRow; onClick?: () => void; onAdd?:()=>void }) {
  const available = row.budget + row.carried;
  const percent = Math.min(100, Math.max(0, available > 0 ? row.spent / available * 100 : row.spent > 0 ? 100 : 0));
  return <div className="category-with-add"><button className="category-row" onClick={onClick} aria-label={`View ${row.name} purchases`}>
    <span className="category-identity"><span className="category-name"><i style={{background:row.color}}/>{row.name}{row.rollover && <RotateCcw size={12}/>}</span><span className="category-detail">{money(row.spent)} of {money(available)} spent</span></span>
    <span className="category-meter" aria-hidden="true"><span style={{width:percent + '%',background:row.remaining < 0 ? 'var(--red)' : row.color}}/></span>
    <strong className={row.remaining < 0 ? 'negative' : ''}>{money(row.remaining)}</strong><ArrowUpRight size={14}/>
  </button>{onAdd&&<button className="icon-btn category-add" aria-label={`Add ${row.name} purchase`} title={`Add ${row.name} purchase`} onClick={onAdd}><Plus size={18}/></button>}</div>;
}

export function Budget({ data, month, save, navigate, canWrite, applyCategoryPlan }: { data: Snapshot; month: string; save: Save; navigate: (tab: string, categoryId?: string) => void; canWrite: boolean; applyCategoryPlan: (plan: CategoryPlan) => Promise<void> }) {
  const [editing, setEditing] = useState<BudgetRow | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [planning, setPlanning] = useState(false);
  const [sorts, setSorts] = useState<Record<Category['group'], SortChoice>>({ flexible: defaultSort, fixed: defaultSort, business: defaultSort });
  const rows = budgetRows(data, month);
  const flexible = rows.filter(category => category.group === 'flexible');
  const toggleSort = (group: Category['group'], key: BudgetSortKey) => setSorts(current => ({ ...current, [group]: {
    key,
    direction: current[group].key === key ? (current[group].direction === 'asc' ? 'desc' : 'asc') : (key === 'name' ? 'asc' : 'desc'),
  } }));
  return <>
    <div className="section-heading"><div><h2>This month's budget</h2><p className="muted">{money(flexible.reduce((total, category) => total + category.remaining, 0))} available for everyday spending</p></div>{canWrite&&<div className="category-plan-actions"><button className="secondary" onClick={() => setPlanning(true)}><ClipboardPaste size={16}/>ChatGPT plan</button><button className="secondary" onClick={() => {setEditing('new');setError('');}}><Plus size={16}/>Category</button></div>}</div>
    {(['flexible','fixed','business'] as const).map(group => <section className="budget-section" key={group}>
      <div className="section-heading"><h3>{group === 'flexible' ? 'Everyday spending' : group === 'fixed' ? 'Fixed & recurring' : 'Rova / business'}</h3><span className="muted small">{money(rows.filter(row => row.group === group).reduce((total, row) => total + row.budget, 0))} / month</span></div>
      <div className="budget-table"><div className="budget-table-head">{(['name','budget','spent','remaining'] as const).map(key => {
        const label = key === 'name' ? 'Category' : key[0].toUpperCase() + key.slice(1);
        const active = sorts[group].key === key;
        const nextDirection = active ? (sorts[group].direction === 'asc' ? 'desc' : 'asc') : (key === 'name' ? 'asc' : 'desc');
        const sortLabel = `Sort ${label} ${key === 'name' ? (nextDirection === 'asc' ? 'A to Z' : 'Z to A') : (nextDirection === 'asc' ? 'low to high' : 'high to low')}`;
        return <button key={key} type="button" className={`budget-sort-button${active ? ' active' : ''}`} aria-label={sortLabel} title={sortLabel} onClick={() => toggleSort(group, key)}>{label}{active ? sorts[group].direction === 'asc' ? <ArrowUp size={11}/> : <ArrowDown size={11}/> : <ArrowUpDown size={11}/>}</button>;
      })}<span/></div>
        {sortBudgetRows(rows.filter(row => row.group === group), sorts[group].key, sorts[group].direction).map(row => <div className="budget-row-container" key={row.id}>
          <button className="budget-table-row" aria-label={`View ${row.name} purchases`} onClick={() => navigate('Transactions', row.id)}><span className="category-name"><i style={{background:row.color}}/><span>{row.name}{row.rollover && <small className="muted">{money(row.carried)} rolled forward</small>}</span></span><span>{money(row.budget)}</span><span>{money(row.spent)}</span><strong className={row.remaining < 0 ? 'negative' : ''}>{money(row.remaining)}</strong></button>
          {canWrite&&<button className="icon-btn" title={`Edit ${row.name} category`} aria-label={`Edit ${row.name} category`} onClick={() => {setEditing(row);setError('');}}><Pencil size={15}/></button>}
        </div>)}
      </div>
    </section>)}
    {planning && <CategoryPlanEditor data={data} apply={applyCategoryPlan} close={() => setPlanning(false)}/>}
    {editing && <Modal title={editing === 'new' ? 'Add category' : editing.name} close={() => setEditing(null)}><form onSubmit={async event => {
      event.preventDefault();const form = new FormData(event.currentTarget);setBusy(true);setError('');
      try {
        const amount = cents(String(form.get('amount')));
        const name = String(form.get('name') ?? '').trim();
        if (data.categories.some(category => category.id !== (editing === 'new' ? null : editing.id) && category.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error('A category with that name already exists.');
        if (editing === 'new') await save('category', {id:crypto.randomUUID(),name,group:form.get('group'),monthly_cents:amount,rollover:form.get('rollover') === 'on',start_month:month,color:'#548a78'});
        else {
          const category = data.categories.find(value => value.id === editing.id)!;
          if (form.get('scope') === 'month') {
            await save('budget', {category_id:editing.id,month,amount_cents:amount});
            if (name !== category.name) await save('category', {...category,name});
          } else await save('category', {...category,name,monthly_cents:amount});
        }
        setEditing(null);
      } catch (failure) { setError((failure as Error).message); } finally {setBusy(false);}
    }}>
      <Field label="Name"><input name="name" required maxLength={100} defaultValue={editing === 'new' ? '' : editing.name}/></Field>
      {editing === 'new' && <><Field label="Group"><select name="group"><option value="flexible">Everyday spending</option><option value="fixed">Fixed & recurring</option><option value="business">Business</option></select></Field><label className="check"><input type="checkbox" name="rollover"/>Roll unused money into next month</label></>}
      <Field label="Monthly amount ($)"><input name="amount" type="number" step="0.01" min="0" max="100000000" required defaultValue={editing === 'new' ? '' : editing.budget / 100}/></Field>
      {editing !== 'new' && <Field label="Apply to"><select name="scope"><option value="month">This month only</option><option value="default">Default monthly amount</option></select></Field>}
      <FormError error={error}/><Submit busy={busy}/>
    </form>{editing !== 'new' && <div className="category-delete-action"><button className="text-btn danger" disabled={busy} onClick={() => {setDeleting(data.categories.find(category => category.id === editing.id)!);setEditing(null);setError('');}}><Trash2 size={15}/>Delete category</button></div>}</Modal>}
    {deleting && <Modal title={`Delete ${deleting.name}?`} close={() => {if(!busy)setDeleting(null);}}><p className="muted">The category and its budget limits will be removed. Purchases and tasks stay in your history.</p><form onSubmit={async event => {event.preventDefault();setBusy(true);setError('');try {const replacement = String(new FormData(event.currentTarget).get('replacement') ?? '') || null;await save('delete_category',{id:deleting.id,replacement_id:replacement});setDeleting(null);}catch(failure){setError((failure as Error).message);}finally{setBusy(false);}}}>
      <Field label="Move existing purchases to"><select name="replacement" required={data.transactions.some(transaction => transaction.splits.some(split => split.category_id === deleting.id))}><option value="" disabled={data.transactions.some(transaction => transaction.splits.some(split => split.category_id === deleting.id))}>Uncategorized</option>{data.categories.filter(category => category.id !== deleting.id).map(category => <option value={category.id} key={category.id}>{category.name}</option>)}</select></Field>
      <p className="small muted">Uncategorized purchases will need review and will not count toward a budget. Split purchases must be moved to another category.</p><FormError error={error}/><button className="primary danger-button" type="submit" disabled={busy}><Trash2 size={15}/>{busy?'Deleting...':'Delete category'}</button>
    </form></Modal>}
  </>;
}
