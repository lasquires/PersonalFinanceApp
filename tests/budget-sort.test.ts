import { test } from 'node:test';
import assert from 'node:assert/strict';
import { budgetRows } from '../src/lib/finance';
import { defaults } from '../src/lib/defaults';
import { sortBudgetRows } from '../src/lib/budget-sort';

const rows = budgetRows(defaults(), '2026-10-01').filter(row => row.group === 'flexible');

test('budget sorting supports each visible column in both directions', () => {
  for (const key of ['name', 'budget', 'spent', 'remaining'] as const) {
    const ascending = sortBudgetRows(rows, key, 'asc');
    const descending = sortBudgetRows(rows, key, 'desc');
    if (key === 'name') assert.deepEqual(descending.map(row => row.id), ascending.map(row => row.id).reverse());
    else {
      assert.deepEqual(ascending.map(row => row[key]), [...ascending.map(row => row[key])].sort((a, b) => a - b));
      assert.deepEqual(descending.map(row => row[key]), [...descending.map(row => row[key])].sort((a, b) => b - a));
    }
    assert.deepEqual(ascending.map(row => row.id).sort(), rows.map(row => row.id).sort());
  }
});

test('budget sorting does not mutate its source and breaks amount ties by category name', () => {
  const original = rows.map(row => row.id);
  const sorted = sortBudgetRows(rows, 'spent', 'desc');
  assert.deepEqual(rows.map(row => row.id), original);
  const tied = sorted.filter(row => row.spent === 0);
  assert.deepEqual(tied.map(row => row.name), [...tied.map(row => row.name)].sort((a, b) => a.localeCompare(b, 'en-US', { sensitivity: 'base' })));
});
