import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvDate, csvTransactions, parseCsv } from '../src/lib/csv';

test('CSV parsing validates dates and creates repeatable import IDs', async () => {
  const parsed = parseCsv('Date,Description,Amount\n9/20/2026,Target,42.75\n9/20/2026,Target,42.75');
  const map = { date:'Date', merchant:'Description', amount:'Amount', sign:'positive', account:'Luke checking' };
  const first = await csvTransactions(parsed, map);
  const second = await csvTransactions(parsed, map);
  assert.equal(first[0].date, '2026-09-20');
  assert.equal(first[0].amount_cents, 4275);
  assert.notEqual(first[0].id, first[1].id);
  assert.deepEqual(first.map(row => row.id), second.map(row => row.id));
});

test('CSV dates reject calendar overflow', () => {
  assert.throws(() => csvDate('2/30/2026'), /Invalid date/);
});
