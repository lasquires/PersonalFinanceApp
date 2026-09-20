import type { BudgetRow, Category, FinancialEvent, Limit, Snapshot, Transaction } from './types';

export const money = (cents: number, decimals = false) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: decimals ? 2 : 0 }).format(cents / 100);
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export const monthOf = (date: string) => date.slice(0, 7) + '-01';
export function addMonths(month: string, count: number) { const d = new Date(month.slice(0, 7) + '-01T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + count); return d.toISOString().slice(0, 10); }
export const monthLabel = (date: string) => new Date(date.slice(0, 7) + '-01T12:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
export function cents(value: string | number) { const n = Number(String(value).replace(/[$,]/g, '')); if (!Number.isFinite(n) || Math.abs(n) > 100000000) throw new Error('Enter a valid dollar amount.'); return Math.round(n * 100); }
export const limitFor = (c: Category, month: string, limits: Limit[]) => limits.find(l => l.category_id === c.id && l.month === month)?.amount_cents ?? c.monthly_cents;
export function allocations(t: Transaction) {
  if (t.excluded || t.removed || t.kind !== 'expense' || t.currency !== 'USD') return [];
  return t.splits.length ? t.splits : [{ category_id: t.category_id ?? 'uncategorized', amount_cents: t.amount_cents }];
}
export function budgetRows(data: Snapshot, month: string): BudgetRow[] {
  const spending = new Map<string, number>(); const pending = new Map<string, number>();
  for (const t of data.transactions) for (const s of allocations(t)) { const key = s.category_id + ':' + monthOf(t.date); spending.set(key, (spending.get(key) ?? 0) + s.amount_cents); if (t.pending) pending.set(key, (pending.get(key) ?? 0) + s.amount_cents); }
  return data.categories.map(c => {
    let carried = 0;
    if (c.rollover) for (let m = c.start_month; m < month; m = addMonths(m, 1)) carried += limitFor(c, m, data.limits) - (spending.get(c.id + ':' + m) ?? 0);
    const budget = month < c.start_month ? 0 : limitFor(c, month, data.limits);
    const spent = spending.get(c.id + ':' + month) ?? 0;
    return { ...c, budget, carried, spent, pendingSpent: pending.get(c.id + ':' + month) ?? 0, remaining: budget + carried - spent };
  });
}
export function validateSplits(amount: number, splits: { amount_cents: number }[]) {
  if (splits.length && (splits.length < 2 || splits.some(s => !Number.isSafeInteger(s.amount_cents) || s.amount_cents === 0 || Math.sign(s.amount_cents) !== Math.sign(amount)) || splits.reduce((a, s) => a + s.amount_cents, 0) !== amount)) throw new Error('Split amounts must have the same sign and add up exactly to the transaction.');
}
export function forecast(data: Snapshot, asOf = today()) {
  let balance = data.reservoir.filter(e => e.date <= asOf).reduce((a, e) => a + e.amount_cents, 0);
  const startBalance = balance; const points: { month: string; balance: number; costs: number; events: FinancialEvent[] }[] = [];
  for (let i = 0; i < data.settings.forecast_months; i++) {
    const month = addMonths(monthOf(asOf), i); const next = addMonths(month, 1);
    const days = new Date(next + 'T12:00:00Z'); days.setUTCDate(0);
    const fraction = i === 0 ? (days.getUTCDate() - Number(asOf.slice(8, 10)) + 1) / days.getUTCDate() : 1;
    const recurring = data.categories.filter(c => month >= c.start_month).reduce((a, c) => a + limitFor(c, month, data.limits), 0);
    const costs = Math.round((recurring + data.settings.annual_irregular_cents / 12) * fraction);
    const events = data.events.filter(e => e.date && e.affects_runway && (e.recurring_monthly ? monthOf(e.date) <= month : e.date >= (i === 0 ? asOf : month) && e.date < next));
    balance -= costs;
    for (const e of events) { const factor = e.recurring_monthly && e.date! < asOf && i === 0 ? fraction : 1; balance += Math.round(e.amount_cents * factor) * (e.direction === 'inflow' ? 1 : -1); }
    points.push({ month, balance, costs, events });
  }
  const crossing = points.findIndex(p => p.balance < data.settings.floor_cents);
  const milestone = data.events.filter(e => e.milestone && e.date && e.date >= asOf).sort((a, b) => a.date!.localeCompare(b.date!))[0];
  return { startBalance, points, monthsToFloor: startBalance < data.settings.floor_cents ? 0 : crossing < 0 ? null : crossing + 1, milestone, milestoneBalance: milestone ? points.find(p => p.month === monthOf(milestone.date!))?.balance : undefined };
}

export function classify(primary: string | undefined, detailed: string | undefined): { kind: Transaction['kind']; review: boolean } {
  if (detailed === 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT' || detailed === 'TRANSFER_IN_ACCOUNT_TRANSFER' || detailed === 'TRANSFER_OUT_ACCOUNT_TRANSFER') return { kind: 'transfer', review: false };
  if (primary === 'INCOME') return { kind: 'income', review: false };
  // P2P/Venmo transfers may be real purchases. Keep them in spending for review.
  return { kind: 'expense', review: !primary || primary.startsWith('TRANSFER') || primary === 'LOAN_PAYMENTS' };
}
