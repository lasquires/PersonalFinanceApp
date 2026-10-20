import type { BudgetRow } from './types';

export type BudgetSortKey = 'name' | 'budget' | 'spent' | 'remaining';
export type BudgetSortDirection = 'asc' | 'desc';

export function sortBudgetRows(rows: BudgetRow[], key: BudgetSortKey, direction: BudgetSortDirection): BudgetRow[] {
  const sign = direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const value = key === 'name'
      ? a.name.localeCompare(b.name, 'en-US', { sensitivity: 'base' })
      : a[key] - b[key];
    return value * sign || a.name.localeCompare(b.name, 'en-US', { sensitivity: 'base' }) || a.id.localeCompare(b.id);
  });
}
