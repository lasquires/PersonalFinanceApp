'use client';
import { browserDb } from './supabase/client';
import { defaults } from './defaults';
import type { Snapshot } from './types';
import { validateSplits } from './finance';
const tables = { categories: 'categories', limits: 'monthly_limits', transactions: 'transactions', accounts: 'accounts', tasks: 'tasks', events: 'financial_events', reservoir: 'reservoir_entries',members:'members',invitations:'household_invitations',tips:'tips' } as const;
export async function readSnapshot(): Promise<Snapshot> {
  const db = browserDb(); const result = defaults();
  await Promise.all(Object.entries(tables).map(async ([key, table]) => {
    const rows: unknown[] = []; let page = 0;
    while (true) { let query = db.from(table).select('*').order(table === 'monthly_limits' ? 'category_id' : 'id'); if (table === 'monthly_limits') query = query.order('month'); const { data, error } = await query.range(page * 1000, page * 1000 + 999); if (error&&table==='household_invitations')break;if (error) throw new Error('Could not load household data. Check your connection and database setup.'); rows.push(...data); if (data.length < 1000) break; page++; }
    Object.assign(result, { [key]: rows });
  }));
  const preferred = ['luke','samantha','dates','gas','household','carwash','offering','medical','food','electricity','water','trash','internet','insurance','gym','chatgpt','pgsharp','shopify','epidemic'];
  result.categories.sort((a, b) => {
    const left = preferred.indexOf(a.id); const right = preferred.indexOf(b.id);
    if (left === -1 && right === -1) return a.name.localeCompare(b.name);
    if (left === -1) return 1;
    if (right === -1) return -1;
    return left - right;
  });
  const { data, error } = await db.from('settings').select('*').eq('id', 1).single(); if (error) throw new Error('Household settings are missing. Finish database setup.'); result.settings = data;
  return result;
}
export async function writeAction(action: string, payload: unknown) {
  const { error } = await browserDb().rpc('household_action', { action, payload, origin: 'member' });
  if (error) throw new Error(error.message.includes('split') ? 'Split amounts must add up exactly.' : 'This change could not be saved. Check the values and try again.');
}
export function previewAction(data: Snapshot, action: string, payload: Record<string, unknown>): Snapshot {
  const next = structuredClone(data);
  if (action === 'settings') next.settings = payload as unknown as Snapshot['settings'];
  else if (action === 'budget') { next.limits = next.limits.filter(x => !(x.category_id === payload.category_id && x.month === payload.month)); next.limits.push(payload as unknown as Snapshot['limits'][number]); }
  else if (action === 'delete_event') next.events = next.events.filter(x => x.id !== payload.id);
  else if (action === 'delete_transaction') next.transactions = next.transactions.map(t => t.id === payload.id ? { ...t, removed: true } : t);
  else {
    const key = ({ category: 'categories', task: 'tasks', event: 'events', reservoir: 'reservoir', transaction: 'transactions' } as const)[action as 'category'];
    if (!key) throw new Error('Unknown change');
    if (action === 'transaction') validateSplits(Number(payload.amount_cents), payload.splits as {amount_cents:number}[]);
    Object.assign(next, { [key]: [...next[key].filter(x => x.id !== payload.id), payload] });
  }
  return next;
}
