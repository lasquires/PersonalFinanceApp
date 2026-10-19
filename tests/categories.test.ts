import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { defaults } from '../src/lib/defaults';
import { budgetRows, sortedCategories } from '../src/lib/finance';
import { previewAction } from '../src/lib/store';

test('category lists are alphabetical, including newly added preview categories', () => {
  const data = defaults();
  assert.deepEqual(sortedCategories(data.categories).map(c => c.name),
    [...data.categories.map(c => c.name)].sort((a, b) => a.localeCompare(b, 'en-US', { sensitivity: 'base' })));
  const added = previewAction(data, 'category', {
    id: 'new', name: 'Apples', group: 'flexible', monthly_cents: 1000,
    rollover: false, start_month: '2026-10-01', color: '#548a78',
  });
  assert.deepEqual(budgetRows(added, '2026-10-01').filter(c => c.group === 'flexible').map(c => c.name),
    sortedCategories(added.categories.filter(c => c.group === 'flexible')).map(c => c.name));
});

test('preview deletion moves purchases and splits without losing history', () => {
  const data = defaults();
  data.transactions = [
    { id:'one', merchant:'Shop', date:'2026-10-01', amount_cents:500, category_id:'gas', splits:[], kind:'expense', excluded:false, pending:false, removed:false, source:'manual', account_id:null, note:'', currency:'USD', needs_review:false },
    { id:'two', merchant:'Split', date:'2026-10-01', amount_cents:500, category_id:null, splits:[{category_id:'gas',amount_cents:200},{category_id:'dates',amount_cents:300}], kind:'expense', excluded:false, pending:false, removed:false, source:'manual', account_id:null, note:'', currency:'USD', needs_review:false },
  ];
  const next = previewAction(data, 'delete_category', {id:'gas',replacement_id:'dates'});
  assert.equal(next.categories.some(c => c.id === 'gas'), false);
  assert.equal(next.transactions.length, 2);
  assert.equal(next.transactions[0].category_id, 'dates');
  assert.equal(next.transactions[1].splits[0].category_id, 'dates');
  assert.equal(data.transactions[0].category_id, 'gas');
  assert.throws(() => previewAction(data, 'delete_category', {id:'gas',replacement_id:null}), /split/i);
});

test('category deletion reassigns purchase links and merchant rules atomically', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid primary key,email text); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; create publication supabase_realtime;`);
    for (const file of ['001_household.sql','002_household_access.sql','003_merchant_category_rules.sql','004_snap_muse_integration.sql','005_dashboard_preferences.sql','006_purchase_reconciliation.sql','009_category_management.sql'])
      await db.exec(await readFile(new URL('../supabase/migrations/' + file, import.meta.url), 'utf8'));
    const luke = '11111111-1111-1111-1111-111111111111';
    await db.exec(`insert into auth.users values('${luke}','luke@example.com'); insert into public.members(id,name,role) values('${luke}','Luke','admin');`);
    await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [luke]);
    await db.exec('set role authenticated');
    await db.query(`select public.household_action('transaction',$1,'member')`, [JSON.stringify({id:'purchase',source:'manual',merchant:'Fuel stop',date:'2026-10-01',amount_cents:500,category_id:'gas',kind:'expense',excluded:false,note:'',splits:[],remember_category:true})]);
    await db.query(`select public.household_action('transaction',$1,'member')`, [JSON.stringify({id:'split',source:'manual',merchant:'Split',date:'2026-10-01',amount_cents:500,category_id:null,kind:'expense',excluded:false,note:'',splits:[{category_id:'gas',amount_cents:200},{category_id:'dates',amount_cents:300}]})]);
    await db.query(`select public.household_action('task',$1,'member')`, [JSON.stringify({id:'task',title:'Test',category_id:'gas',status:'Active',priority:'Normal',assignee:'Together',impact_cents:0,impact_type:'once',notes:''})]);
    await assert.rejects(db.query(`select public.delete_household_category('gas',null)`), /split/i);
    await db.exec('reset role');
    await db.exec(`insert into auth.users values('22222222-2222-2222-2222-222222222222','viewer@example.com'); insert into public.members(id,name,role) values('22222222-2222-2222-2222-222222222222','Viewer','viewer');`);
    await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, ['22222222-2222-2222-2222-222222222222']);
    await db.exec('set role authenticated');
    await assert.rejects(db.query(`select public.delete_household_category('gas','dates')`), /write access/i);
    await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [luke]);
    await db.query(`select public.delete_household_category('gas','dates')`);
    assert.equal((await db.query(`select id from public.categories where id='gas'`)).rows.length, 0);
    assert.deepEqual((await db.query(`select category_id from public.transactions where id='purchase'`)).rows, [{category_id:'dates'}]);
    assert.deepEqual((await db.query<{splits:{category_id:string}[]}>(`select splits from public.transactions where id='split'`)).rows[0].splits.map(s => s.category_id), ['dates','dates']);
    assert.deepEqual((await db.query(`select category_id from public.tasks where id='task'`)).rows, [{category_id:'dates'}]);
    await db.exec('reset role');
    assert.deepEqual((await db.query(`select category_id from private.merchant_category_rules where merchant_key='fuel stop'`)).rows, [{category_id:'dates'}]);
    await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [luke]);
    await db.exec('set role authenticated');
    await db.query(`select public.household_action('transaction',$1,'member')`, [JSON.stringify({id:'unassigned',source:'manual',merchant:'Car wash',date:'2026-10-01',amount_cents:1200,category_id:'carwash',kind:'expense',excluded:false,note:'',splits:[]})]);
    await db.query(`select public.delete_household_category('carwash',null)`);
    assert.equal((await db.query(`select id from public.categories where id='carwash'`)).rows.length, 0);
    assert.deepEqual((await db.query(`select category_id,budget_state,needs_review from public.transactions where id='unassigned'`)).rows,
      [{category_id:null,budget_state:'unbudgeted',needs_review:true}]);
  } finally { await db.close(); }
});
