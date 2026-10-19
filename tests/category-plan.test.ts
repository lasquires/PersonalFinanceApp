import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { defaults } from '../src/lib/defaults';
import { makeCategoryInstructions, parseCategoryPlan } from '../src/lib/category-plan';

test('category instructions disclose only category settings and require explicit deletion', () => {
  const data = defaults();
  data.transactions.push({ id:'private', merchant:'Private merchant', date:'2026-10-01', amount_cents:1234, category_id:'gas', splits:[], kind:'expense', excluded:false, pending:false, removed:false, source:'manual', account_id:null, note:'Private note', currency:'USD', needs_review:false });
  const packet = makeCategoryInstructions(data.categories);
  assert.match(packet, /"id": "gas"/);
  assert.match(packet, /confirm_delete/);
  assert.match(packet, /replacement_id/);
  assert.match(packet, /```json/);
  assert.doesNotMatch(packet, /Private merchant|Private note/);
});

test('plan parser accepts a copyable JSON block with Windows line endings and surrounding text', () => {
  const plan = JSON.stringify({version:1,changes:[{action:'update',id:'gas',name:'Fuel'}]});
  const reply = `Here is the plan:\r\n\r\n\`\`\`json\r\n${plan}\r\n\`\`\`\r\nReview it before applying.`;
  assert.equal(parseCategoryPlan(reply,defaults().categories).changes[0].action,'update');
  assert.throws(() => parseCategoryPlan(`${reply}\n\n\`\`\`json\n${plan}\n\`\`\``,defaults().categories),/one JSON code block/i);
});

test('plan parser accepts explicit additions and updates but never deletes by omission', () => {
  const categories = defaults().categories;
  const plan = parseCategoryPlan('```json\n'+JSON.stringify({version:1,changes:[
    {action:'update',id:'gas',name:'Fuel',monthly_cents:22500},
    {action:'add',name:'Gifts',group:'flexible',monthly_cents:5000,rollover:false},
  ]})+'\n```',categories);
  assert.equal(plan.changes.length,2);
  assert.equal(plan.changes.some(change => change.action === 'delete'),false);
  assert.equal(categories.find(category => category.id === 'gas')?.name,'Gas');
});

test('plan parser requires exact deletion confirmation and a surviving replacement', () => {
  const categories = defaults().categories;
  const deletion = {action:'delete',id:'gas',confirm_name:'Gas',replacement_id:'dates',confirm_delete:true,reason:'Combine fuel with dates'};
  assert.equal(parseCategoryPlan(JSON.stringify({version:1,changes:[deletion]}),categories).changes[0].action,'delete');
  for (const change of [
    {...deletion,confirm_name:'Fuel'},
    {...deletion,confirm_delete:false},
    {...deletion,replacement_id:'missing'},
    {...deletion,replacement_id:'gas'},
  ]) assert.throws(() => parseCategoryPlan(JSON.stringify({version:1,changes:[change]}),categories));
  assert.throws(() => parseCategoryPlan(JSON.stringify({version:1,changes:[deletion,{...deletion,id:'dates',confirm_name:'Dates',replacement_id:'gas'}]}),categories),/replacement|deleted/i);
});

test('plan parser rejects duplicate names, unknown IDs, and non-JSON prose', () => {
  const categories = defaults().categories;
  assert.throws(() => parseCategoryPlan(JSON.stringify({version:1,changes:[{action:'add',name:'Gas',group:'flexible',monthly_cents:100,rollover:false}]}),categories),/name/i);
  assert.throws(() => parseCategoryPlan(JSON.stringify({version:1,changes:[{action:'update',id:'unknown',name:'New'}]}),categories),/unknown/i);
  assert.throws(() => parseCategoryPlan('Here are my changes: '+JSON.stringify({version:1,changes:[]}),categories),/JSON/i);
});

test('database applies a category plan atomically and rejects stale or read-only requests', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid primary key,email text); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; create publication supabase_realtime;`);
    for (const file of ['001_household.sql','002_household_access.sql','003_merchant_category_rules.sql','004_snap_muse_integration.sql','005_dashboard_preferences.sql','006_purchase_reconciliation.sql','009_category_management.sql','010_category_plan.sql'])
      await db.exec(await readFile(new URL('../supabase/migrations/' + file, import.meta.url), 'utf8'));
    const luke='11111111-1111-1111-1111-111111111111', viewer='22222222-2222-2222-2222-222222222222';
    await db.exec(`insert into auth.users values('${luke}','luke@example.com'),('${viewer}','viewer@example.com'); insert into public.members(id,name,role) values('${luke}','Luke','admin'),('${viewer}','Viewer','viewer');`);
    const expected=(await db.query<{categories:unknown}>(`select coalesce(jsonb_object_agg(id,jsonb_build_object('name',name,'group',"group",'monthly_cents',monthly_cents,'rollover',rollover)),'{}'::jsonb) as categories from public.categories`)).rows[0].categories;
    await db.query(`select set_config('request.jwt.claim.sub',$1,false)`,[luke]);
    await db.exec('set role authenticated');
    await db.query(`select public.household_action('transaction',$1,'member')`,[JSON.stringify({id:'purchase',source:'manual',merchant:'Car wash',date:'2026-10-01',amount_cents:1200,category_id:'carwash',kind:'expense',excluded:false,note:'',splits:[]})]);
    const invalid=[{action:'add',name:'Gifts',group:'flexible',monthly_cents:5000,rollover:false},{action:'delete',id:'carwash',confirm_name:'Wrong',replacement_id:'gas',confirm_delete:true,reason:'Merge these categories'}];
    await assert.rejects(db.query(`select public.apply_category_plan($1,$2,$3)`,[JSON.stringify(invalid),JSON.stringify(expected),'2026-10-01']),/name|confirm/i);
    assert.equal((await db.query(`select id from public.categories where name='Gifts'`)).rows.length,0);
    const valid=[{action:'update',id:'gas',name:'Fuel',monthly_cents:22500},{action:'add',name:'Gifts',group:'flexible',monthly_cents:5000,rollover:false},{action:'delete',id:'carwash',confirm_name:'Car wash',replacement_id:'gas',confirm_delete:true,reason:'Merge car wash into fuel'}];
    await db.query(`select public.apply_category_plan($1,$2,$3)`,[JSON.stringify(valid),JSON.stringify(expected),'2026-10-01']);
    assert.deepEqual((await db.query(`select name,monthly_cents from public.categories where id='gas'`)).rows,[{name:'Fuel',monthly_cents:22500}]);
    assert.equal((await db.query(`select id from public.categories where name='Gifts'`)).rows.length,1);
    assert.equal((await db.query(`select id from public.categories where id='carwash'`)).rows.length,0);
    assert.deepEqual((await db.query(`select category_id from public.transactions where id='purchase'`)).rows,[{category_id:'gas'}]);
    await assert.rejects(db.query(`select public.apply_category_plan($1,$2,$3)`,[JSON.stringify(valid),JSON.stringify(expected),'2026-10-01']),/changed|refresh/i);
    await db.query(`select set_config('request.jwt.claim.sub',$1,false)`,[viewer]);
    await assert.rejects(db.query(`select public.apply_category_plan($1,$2,$3)`,[JSON.stringify(valid),JSON.stringify(expected),'2026-10-01']),/write access/i);
  } finally { await db.close(); }
});
