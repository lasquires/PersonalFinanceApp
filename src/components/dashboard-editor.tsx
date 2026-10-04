'use client';
import { useState } from 'react';
import { ArrowDown, ArrowUp, RotateCcw } from 'lucide-react';
import { dashboardSections, defaultDashboardPreferences, type DashboardPreferences, type DashboardSection } from '@/lib/dashboard-preferences';
import type { Snapshot } from '@/lib/types';
import { FormError, Modal } from './ui';

export function DashboardEditor({ data, preferences, save, close, preview }: {
  data: Snapshot; preferences: DashboardPreferences; save: (value: DashboardPreferences) => Promise<void>; close: () => void; preview: boolean;
}) {
  const [draft, setDraft] = useState(() => structuredClone(preferences));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toggleSection = (id: DashboardSection) => setDraft(value => ({ ...value, sections: value.sections.includes(id) ? value.sections.filter(section => section !== id) : [...value.sections, id] }));
  const move = (id: DashboardSection, direction: number) => setDraft(value => {
    const sections = [...value.sections];
    const index = sections.indexOf(id);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= sections.length) return value;
    [sections[index], sections[next]] = [sections[next], sections[index]];
    return { ...value, sections };
  });
  const toggleItem = (field: 'account_ids' | 'category_ids', id: string, allIds: string[]) => setDraft(value => {
    const selected = value[field] ?? allIds;
    return { ...value, [field]: selected.includes(id) ? selected.filter(item => item !== id) : [...selected, id] };
  });
  const ordered = [...draft.sections, ...dashboardSections.map(section => section.id).filter(id => !draft.sections.includes(id))];
  return <Modal title="Customize dashboard" close={() => { if (!busy) close(); }}>
    <form onSubmit={async event => {
      event.preventDefault(); setBusy(true); setError('');
      try { await save(draft); close(); } catch (failure) { setError((failure as Error).message); } finally { setBusy(false); }
    }}>
      <fieldset disabled={busy} className="dashboard-settings-fields">
        <legend>{preview ? 'Local preview' : 'Your dashboard'}</legend>
        <div className="dashboard-section-options">{ordered.map(id => {
          const index = draft.sections.indexOf(id);
          const label = dashboardSections.find(section => section.id === id)!.label;
          return <div className="dashboard-option" key={id}>
            <label className="switch-label"><input type="checkbox" role="switch" checked={index >= 0} onChange={() => toggleSection(id)}/><span>{label}</span></label>
            <div className="reorder-controls"><button className="icon-btn" type="button" title={`Move ${label.toLowerCase()} up`} aria-label={`Move ${label.toLowerCase()} up`} disabled={index <= 0} onClick={() => move(id, -1)}><ArrowUp size={16}/></button><button className="icon-btn" type="button" title={`Move ${label.toLowerCase()} down`} aria-label={`Move ${label.toLowerCase()} down`} disabled={index < 0 || index === draft.sections.length - 1} onClick={() => move(id, 1)}><ArrowDown size={16}/></button></div>
          </div>;
        })}</div>
        {draft.sections.includes('accounts') && data.accounts.length > 0 && <fieldset className="dashboard-item-options"><legend>Accounts</legend>
          <label className="check"><input type="checkbox" checked={draft.account_ids === null} onChange={event => setDraft(value => ({ ...value, account_ids: event.target.checked ? null : data.accounts.map(account => account.id) }))}/>All accounts</label>
          {data.accounts.map(account => <label className="check" key={account.id}><input type="checkbox" checked={draft.account_ids === null || draft.account_ids.includes(account.id)} onChange={() => toggleItem('account_ids', account.id, data.accounts.map(item => item.id))}/><span>{account.name}{account.mask ? ` · ${account.mask}` : ''}<small>{account.member} · {account.institution}</small></span></label>)}
        </fieldset>}
        {draft.sections.includes('spending') && <fieldset className="dashboard-item-options"><legend>Categories</legend>
          <label className="check"><input type="checkbox" checked={draft.category_ids === null} onChange={event => setDraft(value => ({ ...value, category_ids: event.target.checked ? null : data.categories.map(category => category.id) }))}/>All categories</label>
          <div className="category-options">{data.categories.map(category => <label className="check" key={category.id}><input type="checkbox" checked={draft.category_ids === null || draft.category_ids.includes(category.id)} onChange={() => toggleItem('category_ids', category.id, data.categories.map(item => item.id))}/>{category.name}</label>)}</div>
        </fieldset>}
      </fieldset>
      <FormError error={error}/><div className="dialog-actions"><button className="text-btn" type="button" disabled={busy} onClick={() => setDraft(defaultDashboardPreferences())}><RotateCcw size={15}/>Reset</button><button className="primary" type="submit" disabled={busy}>{busy ? 'Saving...' : 'Save dashboard'}</button></div>
    </form>
  </Modal>;
}
