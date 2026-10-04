import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const luke='11111111-1111-1111-1111-111111111111';
async function database() {
  const db=new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid primary key,email text); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; create publication supabase_realtime;`);
  for(const file of ['001_household.sql','002_household_access.sql','003_merchant_category_rules.sql','004_snap_muse_integration.sql','005_dashboard_preferences.sql']) await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
  await db.exec(`insert into auth.users values('${luke}','luke@example.com'); insert into public.members(id,name,role) values('${luke}','Luke','admin'); insert into public.transactions(id,merchant,date,amount_cents,category_id,source) values('legacy','Legacy store','2026-10-01',500,'gas','plaid');`);
  await db.exec(await readFile(new URL('../supabase/migrations/006_purchase_reconciliation.sql',import.meta.url),'utf8'));
  await db.query(`select set_config('request.jwt.claim.sub',$1,false)`,[luke]);
  return db;
}
const purchase=(id:string,source='manual',remember=false)=>({id,source,merchant:'The Salvation Army',date:'2026-10-01',amount_cents:1375,category_id:source==='manual'?'household':null,kind:'expense',excluded:false,note:'Keep',splits:[],remember_category:remember});
async function action(db:PGlite,name:string,value:unknown){await db.query(`select public.household_action($1,$2,'member')`,[name,JSON.stringify(value)]);}
test('database preserves history and holds remembered imports for manual duplicates, with reversible matching',async()=>{
  const db=await database();try{
    await db.exec('set role authenticated');
    await action(db,'transaction',purchase('manual','manual',true));
    await action(db,'transaction',purchase('csv','csv'));
    assert.equal((await db.query<{budget_state:string}>(`select budget_state from public.transactions where id='csv'`)).rows[0].budget_state,'held');
    await action(db,'match_import',{import_id:'csv',manual_id:'manual'});
    assert.equal(Number((await db.query<{total:number}>(`select sum(amount_cents) total from public.assistant_spending`)).rows[0].total),1875);
    await action(db,'unmatch_import',{import_id:'csv'});
    assert.equal((await db.query<{budget_state:string}>(`select budget_state from public.transactions where id='csv'`)).rows[0].budget_state,'unbudgeted');
    await action(db,'match_import',{import_id:'csv',manual_id:'manual'});
    await action(db,'delete_transaction',{id:'manual'});
    assert.equal((await db.query<{budget_state:string}>(`select budget_state from public.transactions where id='csv'`)).rows[0].budget_state,'unbudgeted');
  }finally{await db.close();}
});
test('database default imports stay unbudgeted, late manual entry holds auto budget, and viewers cannot match',async()=>{
 const db=await database();try{
  await db.exec('set role authenticated');
  await action(db,'transaction',purchase('ordinary','csv'));
  assert.equal((await db.query<{category_id:string|null}>(`select category_id from public.transactions where id='ordinary'`)).rows[0].category_id,null);
  await action(db,'transaction',{...purchase('rule','manual',true),merchant:'Fuel stop',amount_cents:2000,category_id:'gas'});
  await action(db,'transaction',{...purchase('auto','csv'),merchant:'Fuel stop',amount_cents:3300});
  assert.equal((await db.query<{budget_state:string}>(`select budget_state from public.transactions where id='auto'`)).rows[0].budget_state,'budgeted');
  await action(db,'transaction',{...purchase('late'),merchant:'Fuel stop',amount_cents:3300,category_id:'gas'});
  assert.equal((await db.query<{budget_state:string}>(`select budget_state from public.transactions where id='auto'`)).rows[0].budget_state,'held');
  await action(db,'transaction',{...purchase('second'),merchant:'Fuel stop',amount_cents:3300,category_id:'gas'});
  await action(db,'separate_import',{import_id:'auto',manual_id:'late'});
  assert.equal((await db.query<{budget_state:string}>(`select budget_state from public.transactions where id='auto'`)).rows[0].budget_state,'held');
  assert.deepEqual((await db.query(`select manual_id from public.list_import_match_rejections()`)).rows,[{manual_id:'late'}]);
  await action(db,'separate_import',{import_id:'auto',manual_id:'second'});
  assert.equal((await db.query<{budget_state:string}>(`select budget_state from public.transactions where id='auto'`)).rows[0].budget_state,'budgeted');
  assert.equal((await db.query<{needs_review:boolean}>(`select needs_review from public.transactions where id='auto'`)).rows[0].needs_review,false);
  await db.exec('reset role'); await db.exec(`insert into auth.users values('22222222-2222-2222-2222-222222222222','viewer@example.com'); insert into public.members(id,name,role) values('22222222-2222-2222-2222-222222222222','Viewer','viewer'); select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false); set role authenticated;`);
  await assert.rejects(action(db,'match_import',{import_id:'ordinary',manual_id:'rule'}),/write access/i);
 }finally{await db.close();}
});
test('a changed held bank charge returns to unbudgeted review on posting and modification',async()=>{
 const db=await database();try{
  const accounts=[{account_id:'checking',name:'Checking',mask:'1234',type:'depository',balances:{current:1000}}];
  await db.query(`select public.server_save_item($1,$2,$3,$4,$5)`,['item','test-only-token','Example Bank','Luke',JSON.stringify(accounts)]);
  await action(db,'transaction',{...purchase('manual','manual',true),amount_cents:3300});
  const pending={id:'pending',account_id:'checking',merchant:'The Salvation Army',date:'2026-10-01',amount_cents:3300,category_id:null,kind:'expense',pending:true,pending_transaction_id:null,currency:'USD',needs_review:true};
  const sync=async(cursor:string,next:string,rows:unknown[])=>db.query(`select public.server_apply_sync($1,$2,$3,$4,$5,$6,$7)`,['item',cursor,next,JSON.stringify(rows),'[]','[]',JSON.stringify(accounts)]);
  await sync('','one',[pending]);
  await sync('one','unchanged',[pending]);
  assert.deepEqual((await db.query(`select budget_state,needs_review from public.transactions where id='pending'`)).rows,[{budget_state:'held',needs_review:true}]);
  await sync('unchanged','two',[{...pending,id:'posted',pending:false,pending_transaction_id:'pending',amount_cents:3500}]);
  assert.deepEqual((await db.query(`select budget_state,needs_review from public.transactions where id='posted'`)).rows,[{budget_state:'unbudgeted',needs_review:true}]);
  assert.equal(Number((await db.query<{total:number}>(`select sum(amount_cents) total from public.assistant_spending where id<>'legacy'`)).rows[0].total),3300);
  await sync('two','three',[{...pending,id:'modified'}]);
  await sync('three','four',[{...pending,id:'modified',amount_cents:3500}]);
  assert.deepEqual((await db.query(`select budget_state,needs_review from public.transactions where id='modified'`)).rows,[{budget_state:'unbudgeted',needs_review:true}]);
  await sync('four','five',[{...pending,id:'steady'}]);
  await sync('five','six',[{...pending,id:'steady-posted',pending:false,pending_transaction_id:'steady'}]);
  assert.deepEqual((await db.query(`select budget_state,needs_review from public.transactions where id='steady-posted'`)).rows,[{budget_state:'held',needs_review:true}]);
 }finally{await db.close();}
});
test('a removed pending record cannot reclaim a manual purchase already matched elsewhere',async()=>{
 const db=await database();try{
  const accounts=[{account_id:'checking',name:'Checking',mask:'1234',type:'depository',balances:{current:1000}}];
  await db.query(`select public.server_save_item($1,$2,$3,$4,$5)`,['item','test-only-token','Example Bank','Luke',JSON.stringify(accounts)]);
  await action(db,'transaction',purchase('manual'));
  const pending={id:'pending',account_id:'checking',merchant:'The Salvation Army',date:'2026-10-01',amount_cents:1375,category_id:null,kind:'expense',pending:true,pending_transaction_id:null,currency:'USD',needs_review:true};
  const sync=async(cursor:string,next:string,rows:unknown[],removed:unknown[]=[])=>db.query(`select public.server_apply_sync($1,$2,$3,$4,$5,$6,$7)`,['item',cursor,next,JSON.stringify(rows),'[]',JSON.stringify(removed),JSON.stringify(accounts)]);
  await sync('','one',[pending]);
  await action(db,'match_import',{import_id:'pending',manual_id:'manual'});
  await sync('one','two',[],[{transaction_id:'pending'}]);
  await action(db,'transaction',purchase('other','csv'));
  await action(db,'match_import',{import_id:'other',manual_id:'manual'});
  await sync('two','three',[{...pending,id:'posted',pending:false,pending_transaction_id:'pending'}]);
  assert.deepEqual((await db.query(`select budget_state,matched_manual_id,needs_review from public.transactions where id='posted'`)).rows,[{budget_state:'unbudgeted',matched_manual_id:null,needs_review:true}]);
  await sync('three','four',[pending]);
  assert.deepEqual((await db.query(`select budget_state,matched_manual_id from public.transactions where id='pending'`)).rows,[{budget_state:'unbudgeted',matched_manual_id:null}]);
 }finally{await db.close();}
});
test('pending replacement carries a confirmed match and flags changed amount without touching manual splits',async()=>{
 const db=await database();try{
  const accounts=[{account_id:'checking',name:'Checking',mask:'1234',type:'depository',balances:{current:1000}}];
  await db.query(`select public.server_save_item($1,$2,$3,$4,$5)`,['item','test-only-token','Example Bank','Luke',JSON.stringify(accounts)]);
  await action(db,'transaction',{...purchase('manual'),splits:[{category_id:'household',amount_cents:1000},{category_id:'gas',amount_cents:375}],category_id:null});
  const pending={id:'pending',account_id:'checking',merchant:'The Salvation Army',date:'2026-10-01',amount_cents:1375,category_id:null,kind:'expense',pending:true,pending_transaction_id:null,currency:'USD',needs_review:true};
  await db.query(`select public.server_apply_sync($1,$2,$3,$4,$5,$6,$7)`,['item','','one',JSON.stringify([pending]),'[]','[]',JSON.stringify(accounts)]);
  await action(db,'match_import',{import_id:'pending',manual_id:'manual'});
  await db.query(`select public.server_apply_sync($1,$2,$3,$4,$5,$6,$7)`,['item','one','two','[]',JSON.stringify([{...pending,id:'posted',pending:false,pending_transaction_id:'pending',amount_cents:1500}]),'[]',JSON.stringify(accounts)]);
  const posted=(await db.query<{matched_manual_id:string;needs_review:boolean;budget_state:string}>(`select matched_manual_id,needs_review,budget_state from public.transactions where id='posted'`)).rows[0];
  assert.deepEqual(posted,{matched_manual_id:'manual',needs_review:true,budget_state:'matched'});
  assert.equal(Number((await db.query<{total:number}>(`select sum(amount_cents) total from public.assistant_spending where id<>'legacy'`)).rows[0].total),1375);
  await action(db,'transaction',purchase('another','csv'));
  await assert.rejects(action(db,'match_import',{import_id:'another',manual_id:'manual'}),/eligible unmatched/);
 }finally{await db.close();}
});
