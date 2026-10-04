'use client';
import { useState } from 'react';
import { ArrowRight, ArrowUpRight, CalendarDays, CheckCheck, ChevronRight, CreditCard, Landmark, SlidersHorizontal, Wallet, WalletCards } from 'lucide-react';
import { budgetRows, forecast, money, monthLabel, today } from '@/lib/finance';
import type { DashboardPreferences, DashboardSection } from '@/lib/dashboard-preferences';
import type { MemberRole, Snapshot } from '@/lib/types';
import { CategoryBar, type Save } from './budget';
import { DashboardEditor } from './dashboard-editor';
import { suggestions, TaskRow } from './tasks';
import { Empty } from './ui';
import { WeeklyTips } from './weekly-tips';

export function Home({ data, role, month, navigate, save, onError, preferences, savePreferences, preferencesLoading, preferencesError, preview }: {
  data: Snapshot; role: MemberRole; month: string; navigate: (tab: string, categoryId?: string, accountId?: string) => void;
  save: Save; onError: (error: string) => void; preferences: DashboardPreferences;
  savePreferences: (value: DashboardPreferences) => Promise<void>; preferencesLoading: boolean; preferencesError: string; preview: boolean;
}) {
  const [customizing, setCustomizing] = useState(false);
  const [categoriesExpanded, setCategoriesExpanded] = useState(false);
  const rows = budgetRows(data, month);
  const flexible = rows.filter(category => category.group === 'flexible');
  const left = flexible.reduce((total, category) => total + category.remaining, 0);
  const spent = flexible.reduce((total, category) => total + category.spent, 0);
  const available = flexible.reduce((total, category) => total + category.budget + category.carried, 0);
  const visibleCategories = rows.filter(category => preferences.category_ids === null || preferences.category_ids.includes(category.id));
  const accounts = data.accounts.filter(account => preferences.account_ids === null || preferences.account_ids.includes(account.id));
  const cashAccounts = accounts.filter(account => account.type === 'depository');
  const creditAccounts = accounts.filter(account => account.type === 'credit');
  const accountTotal = (values: typeof accounts) => values.every(account => account.balance_cents !== null) ? money(values.reduce((total, account) => total + (account.balance_cents ?? 0), 0), true) : '--';
  const plan = forecast(data);
  const tasks = [...data.tasks, ...suggestions(data)].filter(task => ['Active', 'Suggested'].includes(task.status)).sort((a, b) => Number(b.priority === 'High') - Number(a.priority === 'High')).slice(0, 3);
  const events = data.events.filter(event => event.date && event.date >= today()).sort((a, b) => a.date!.localeCompare(b.date!)).slice(0, 4);
  const transactions = data.transactions.filter(transaction => !transaction.removed && transaction.date.startsWith(month.slice(0, 7))).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  const review = data.transactions.filter(transaction => !transaction.removed && transaction.date.startsWith(month.slice(0, 7)) && (transaction.needs_review || (!transaction.category_id && !transaction.splits.length && transaction.kind === 'expense' && !transaction.excluded))).length;
  const snap = [...data.snap_balances].sort((a, b) => b.observed_at.localeCompare(a.observed_at))[0];
  const snapFresh = snap && Date.now() - Date.parse(snap.observed_at) <= 36 * 60 * 60 * 1000;
  const openButton = (label: string, tab: string) => <button className="icon-btn" title={label} aria-label={label} onClick={() => navigate(tab)}><ArrowUpRight size={18}/></button>;
  const renderSection = (section: DashboardSection) => {
    switch (section) {
      case 'spending': return <section className="dashboard-section spending-section" aria-label="Spending categories">
        <div className="section-heading"><h2><Wallet size={18}/>Spending categories</h2>{openButton('Open budget', 'Budget')}</div>
        <div className="spending-column-labels"><span>Category</span><span>Remaining</span></div>
        <div className="category-list">{(categoriesExpanded ? visibleCategories : visibleCategories.slice(0, 6)).map(category => <CategoryBar key={category.id} row={category} onClick={() => navigate('Transactions', category.id)}/>)}</div>
        {visibleCategories.length > 6 && <button className="text-btn" aria-expanded={categoriesExpanded} onClick={() => setCategoriesExpanded(value => !value)}>{categoriesExpanded ? 'Show fewer categories' : `Show ${visibleCategories.length - 6} more categories`}<ChevronRight size={15}/></button>}
        {!visibleCategories.length && <Empty title="No categories selected"/>}
      </section>;
      case 'accounts': return <section className="dashboard-section accounts-section" aria-label="Account balances">
        <div className="section-heading"><h2><Landmark size={18}/>Accounts</h2>{openButton('Manage accounts', 'Settings')}</div>
        {accounts.length > 0 && <div className="account-totals">{cashAccounts.length > 0 && <div><span>Cash balance</span><strong>{accountTotal(cashAccounts)}</strong></div>}{creditAccounts.length > 0 && <div><span>Credit card balance</span><strong>{accountTotal(creditAccounts)}</strong></div>}</div>}
        {accounts.map(account => <button className="dashboard-account" key={account.id} onClick={() => navigate('Transactions', undefined, account.id)}>
          <span className={'account-symbol ' + (account.type === 'credit' ? 'credit' : '')}>{account.type === 'credit' ? <CreditCard size={18}/> : <Landmark size={18}/>}</span>
          <span className="grow"><strong>{account.name}</strong><small>{account.institution}{account.mask ? ` · ${account.mask}` : ''} · {account.member}</small><small className={account.sync_error ? 'negative' : 'muted'}>{account.sync_error ? 'Connection needs attention' : account.last_synced_at ? `Updated ${new Date(account.last_synced_at).toLocaleDateString('en-US', {month:'short',day:'numeric'})}` : 'Awaiting bank update'}</small></span>
          <span className="account-balance"><strong>{account.balance_cents === null ? '--' : money(account.balance_cents, true)}</strong><small>Current balance</small></span><ChevronRight size={15} className="muted"/>
        </button>)}
        {!accounts.length && <Empty title={data.accounts.length ? 'No accounts selected' : 'No accounts connected'} action={data.accounts.length ? undefined : 'Connect account'} onAction={() => navigate('Settings')}/>}
      </section>;
      case 'reserve': return <section className="dashboard-section reserve-section" aria-label="Reserve and runway">
        <div className="section-heading"><h2><Landmark size={18}/>Reserve & runway</h2>{openButton('Open financial plan', 'Plan')}</div>
        <div className="module-amount">{data.reservoir.length ? money(plan.startBalance, true) : '--'}</div>
        <div className="reserve-summary"><div><span>Estimated runway</span><strong>{data.reservoir.length ? plan.monthsToFloor === null ? '36+ months' : `${plan.monthsToFloor} months` : '--'}</strong></div><div><span>Protected floor</span><strong>{money(data.settings.floor_cents)}</strong></div></div>
        {!data.reservoir.length && <button className="text-btn" onClick={() => navigate('Plan')}>Enter reserve balance<ArrowRight size={15}/></button>}
        {plan.milestone && plan.milestoneBalance !== undefined && <div className="detail-line"><span>{plan.milestone.name}</span><strong>{money(plan.milestoneBalance)}</strong></div>}
      </section>;
      case 'snap': return <section className="dashboard-section snap-section" aria-label="SNAP balance">
        <div className="section-heading"><h2><WalletCards size={18}/>SNAP balance</h2>{openButton('Manage SNAP updates', 'Settings')}</div>
        <div className="module-amount">{snap ? money(snap.balance_cents, true) : '--'}</div>
        {snap ? <><div className="detail-line"><span>Benefit month</span><strong>{monthLabel(snap.benefit_month)}</strong></div><div className="sync-line"><i className={snapFresh ? 'fresh' : 'stale'}/><span>{snapFresh ? 'Checked' : 'Last checked'} {new Date(snap.observed_at).toLocaleString()}</span></div></> : <button className="text-btn" onClick={() => navigate('Settings')}>Connect Muse<ArrowRight size={15}/></button>}
      </section>;
      case 'tasks': return <section className="dashboard-section" aria-label="Tasks">
        <div className="section-heading"><h2><CheckCheck size={18}/>Tasks</h2>{openButton('View all tasks', 'Tasks')}</div>
        {tasks.map(task => <TaskRow key={task.id} task={task} onClick={() => navigate('Tasks')} onDone={() => { if (role !== 'viewer') void save('task', {...task, status:'Done'}).catch(error => onError(error.message)); }}/>) }
        {!tasks.length && <Empty title="All caught up"/>}
      </section>;
      case 'tips': return <WeeklyTips tips={data.tips} role={role} save={save} onError={onError}/>;
      case 'upcoming': return <section className="dashboard-section" aria-label="Upcoming events">
        <div className="section-heading"><h2><CalendarDays size={18}/>Upcoming</h2>{openButton('Open calendar', 'Plan')}</div>
        {events.map(event => <button className="event-row" key={event.id} onClick={() => navigate('Plan')}><span className="date-tile"><span>{new Date(event.date! + 'T12:00:00').toLocaleDateString('en-US',{month:'short'})}</span><strong>{Number(event.date!.slice(8))}</strong></span><span className="grow"><strong>{event.name}</strong><small className="muted">{event.certainty}</small></span><strong>{event.direction === 'inflow' ? '+' : ''}{money(event.amount_cents)}</strong></button>)}
        {!events.length && <Empty title="No upcoming events" action="Add event" onAction={() => navigate('Plan')}/>}
      </section>;
      case 'activity': return <section className="dashboard-section" aria-label="Recent transactions">
        <div className="section-heading"><h2>Recent transactions</h2>{openButton('View transactions', 'Transactions')}</div>
        {transactions.map(transaction => <button className="activity-row" key={transaction.id} onClick={() => navigate('Transactions')}><span className="merchant-avatar">{transaction.merchant[0]}</span><span className="grow"><strong>{transaction.merchant}</strong><small className="muted">{new Date(transaction.date + 'T12:00:00').toLocaleDateString('en-US', {month:'short',day:'numeric'})} · {transaction.splits.length ? 'Split' : data.categories.find(category => category.id === transaction.category_id)?.name ?? 'Uncategorized'}{transaction.pending ? ' · Pending' : ''}</small></span><strong>{transaction.amount_cents < 0 ? '+' : ''}{money(Math.abs(transaction.amount_cents), true)}</strong></button>)}
        {!transactions.length && <Empty title="No activity this month" action="Add transaction" onAction={() => navigate('Transactions')}/>}
      </section>;
    }
  };
  return <>
    <div className="dashboard-heading"><h1>Overview</h1><div className="dashboard-actions">{review > 0 && <button className="review-link" onClick={() => navigate('Transactions', 'review')}>{review} to review<ChevronRight size={14}/></button>}<button className="icon-btn" title="Customize dashboard" aria-label="Customize dashboard" disabled={preferencesLoading} onClick={() => setCustomizing(true)}><SlidersHorizontal size={20}/></button></div></div>
    {preferencesError && <p className="form-error" role="alert">{preferencesError}</p>}
    {preferences.sections.includes('spending') && <div className="dashboard-summary"><div className="summary-primary"><span>Available to spend</span><strong className={'big-money ' + (left < 0 ? 'negative' : '')}>{money(left)}</strong><small>Everyday budget · {monthLabel(month)}</small></div><div><span>Spent</span><strong>{money(spent)}</strong></div><div><span>Budget + rollover</span><strong>{money(available)}</strong></div></div>}
    <div className="dashboard-grid">{preferences.sections.filter(section => section !== 'tips' || data.tips.some(tip => tip.status === 'active' && (!tip.expires_at || tip.expires_at >= today()))).map(section => <div key={section} className={'dashboard-slot slot-' + section}>{renderSection(section)}</div>)}</div>
    {!preferences.sections.length && <Empty title="Your dashboard is empty" action="Customize dashboard" onAction={() => setCustomizing(true)}/>}
    {customizing && <DashboardEditor data={data} preferences={preferences} save={savePreferences} close={() => setCustomizing(false)} preview={preview}/>}
  </>;
}
