import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allocations, budgetRows, classify, forecast, validateSplits } from '../src/lib/finance';
import { defaults } from '../src/lib/defaults';
import type { Transaction } from '../src/lib/types';
const tx = (changes: Partial<Transaction> = {}): Transaction => ({ id: '1', merchant: 'Store', account_id: null, date: '2026-09-10', amount_cents: 2000, category_id: 'luke', kind: 'expense', excluded: false, pending: false, removed: false, note: '', splits: [], source: 'manual', currency: 'USD', needs_review: false, ...changes });
test('purchases count once; card payments and trust transfers do not count', () => { const d = defaults(); d.categories.forEach(c => c.start_month = '2026-09-01'); d.transactions = [tx(), tx({ id: '2', kind: classify('LOAN_PAYMENTS', 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT').kind }), tx({ id: '3', kind: 'transfer' })]; assert.equal(budgetRows(d, '2026-09-01').find(c => c.id === 'luke')?.spent, 2000); });
test('refunds restore budget and removed transactions unwind spending', () => { const d = defaults(); d.transactions = [tx(), tx({ id: '2', amount_cents: -500 }), tx({ id: '3', removed: true })]; assert.equal(budgetRows(d, '2026-09-01').find(c => c.id === 'luke')?.spent, 1500); });
test('category spending nets charges against refunds even when legacy credits are typed as income', () => {
  const d = defaults();
  d.categories.forEach(c => c.start_month = '2026-09-01');
  d.categories.find(c => c.id === 'household')!.monthly_cents = 31600;
  d.transactions = [
    tx({id:'charge',category_id:'household',amount_cents:96700}),
    tx({id:'return',category_id:'household',amount_cents:-18529}),
    tx({id:'bank-return',source:'plaid',category_id:'household',kind:'income',budget_state:'budgeted',amount_cents:-12500}),
    tx({id:'old-manual-return',category_id:'household',kind:'income',amount_cents:-5500}),
    tx({id:'credits',category_id:'household',amount_cents:-2371}),
    tx({id:'transfer',category_id:'household',kind:'transfer',amount_cents:-70000}),
    tx({id:'paycheck',category_id:null,kind:'income',amount_cents:-55000}),
    tx({id:'uncategorized-deposit',category_id:'household',kind:'income',budget_state:'unbudgeted',amount_cents:-4000}),
    tx({id:'positive-income',category_id:'household',kind:'income',amount_cents:2500}),
    tx({id:'excluded',category_id:'household',amount_cents:-1000,excluded:true}),
    tx({id:'held',category_id:'household',amount_cents:-1000,budget_state:'held'}),
    tx({id:'matched',category_id:'household',amount_cents:-1000,budget_state:'matched',matched_manual_id:'charge'}),
    tx({id:'removed',category_id:'household',amount_cents:-1000,removed:true}),
    tx({id:'foreign',category_id:'household',amount_cents:-1000,currency:'CAD'})
  ];
  // $967 charged - $389 returned = $578 net spent; $316 budget => $262 over.
  const household=budgetRows(d,'2026-09-01').find(c=>c.id==='household')!;
  assert.equal(household.spent,57800);
  assert.equal(household.budget,31600);
  assert.equal(household.remaining,-26200);
  assert.equal(d.transactions[2].amount_cents,-12500); // No historical records mutated.
});
test('categorized income credits use signed split amounts but uncategorized income is never spending', () => {
  const d=defaults(); d.categories.forEach(c=>c.start_month='2026-09-01');
  d.transactions=[
    tx({id:'split-credit',kind:'income',category_id:null,amount_cents:-5500,splits:[{category_id:'household',amount_cents:-2500},{category_id:'gas',amount_cents:-3000}]}),
    tx({id:'plain-paycheck',kind:'income',category_id:null,amount_cents:-250000})
  ];
  assert.equal(budgetRows(d,'2026-09-01').find(c=>c.id==='household')!.spent,-2500);
  assert.equal(budgetRows(d,'2026-09-01').find(c=>c.id==='gas')!.spent,-3000);
  assert.deepEqual(allocations(d.transactions[1]),[]);
});
test('excluding one split preserves the transaction total and only budgets included portions', () => {
  const d=defaults(); d.categories.forEach(c=>c.start_month='2026-09-01');
  d.transactions=[
    tx({id:'buy',amount_cents:10000,category_id:null,splits:[
      {category_id:'household',amount_cents:6500},
      {category_id:'gas',amount_cents:3500,excluded:true}
    ]}),
    tx({id:'refund',amount_cents:-2000,category_id:null,splits:[
      {category_id:'household',amount_cents:-1500},
      {category_id:'gas',amount_cents:-500,excluded:true}
    ]})
  ];
  for(const t of d.transactions)validateSplits(t.amount_cents,t.splits);
  assert.equal(d.transactions[0].amount_cents,10000);
  assert.equal(d.transactions[1].amount_cents,-2000);
  assert.deepEqual(allocations(d.transactions[0]),[{category_id:'household',amount_cents:6500}]);
  assert.deepEqual(allocations(d.transactions[1]),[{category_id:'household',amount_cents:-1500}]);
  assert.equal(budgetRows(d,'2026-09-01').find(c=>c.id==='household')!.spent,5000);
  assert.equal(budgetRows(d,'2026-09-01').find(c=>c.id==='gas')!.spent,0);
  d.transactions[0].splits[1].excluded=false;
  assert.equal(budgetRows(d,'2026-09-01').find(c=>c.id==='gas')!.spent,3500);
  // Old split rows without the optional flag remain fully included.
  assert.equal(allocations(tx({splits:[{category_id:'gas',amount_cents:2000}]})).length,1);
});
test('personal rollover includes overspending; other categories reset', () => { const d = defaults(); d.categories.forEach(c => c.start_month = '2026-08-01'); d.transactions = [tx({ date: '2026-08-12', amount_cents: 6000 }), tx({ id: '2', category_id: 'dates', date: '2026-08-12', amount_cents: 2000 })]; const rows = budgetRows(d, '2026-09-01'); assert.equal(rows.find(c => c.id === 'luke')?.remaining, 4000); assert.equal(rows.find(c => c.id === 'dates')?.remaining, 10000); assert.equal(rows.find(c => c.id === 'samantha')?.remaining, 10000); });
test('split validation requires exact integer-cent signed totals', () => { assert.throws(() => validateSplits(1000, [{ amount_cents: 500 }, { amount_cents: 501 }])); assert.throws(() => validateSplits(1000, [{ amount_cents: -500 }, { amount_cents: 1500 }])); validateSplits(-1000, [{ amount_cents: -400 }, { amount_cents: -600 }]); });
test('pending spend is reserved; foreign currency not mistaken for dollars', () => { assert.equal(allocations(tx({ pending: true }))[0].amount_cents, 2000); assert.deepEqual(allocations(tx({ currency: 'CAD' })), []); });
test('P2P payments are not silently excluded', () => { assert.deepEqual(classify('TRANSFER_OUT', 'TRANSFER_OUT_OTHER_TRANSFER'), { kind: 'expense', review: true }); });
test('forecast applies one-offs once and monthly funding repeatedly, excludes past one-offs', () => { const d = defaults(); d.categories = []; d.settings.annual_irregular_cents = 0; d.reservoir = [{ id: '1', date: '2026-09-01', amount_cents: 1000000, note: '', kind: 'initial', created_at: '' }]; d.events = [{ id: 'e', name: 'Tuition', date: '2026-10-10', amount_cents: 200000, direction: 'outflow', certainty: 'Confirmed', notes: '', affects_runway: true, recurring_monthly: false, milestone: false }, { id: 'f', name: 'Funding', date: '2026-11-01', amount_cents: 100000, direction: 'inflow', certainty: 'Confirmed', notes: '', affects_runway: true, recurring_monthly: true, milestone: true }]; const f = forecast(d, '2026-09-01'); assert.equal(f.points[0].balance, 1000000); assert.equal(f.points[1].balance, 800000); assert.equal(f.points[2].balance, 900000); assert.equal(f.points[3].balance, 1000000); assert.equal(f.milestoneBalance, 900000); });
