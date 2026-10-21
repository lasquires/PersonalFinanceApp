import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const luke = '11111111-1111-1111-1111-111111111111';
const account = [{account_id:'card',name:'Credit Card',mask:'0600',type:'credit',balances:{current:1000}}];
const posted = {id:'posted',account_id:'card',merchant:'Walmart',date:'2026-10-05',amount_cents:18529,category_id:'household',kind:'expense',pending:false,pending_transaction_id:null,currency:'USD',needs_review:false};

async function database() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid primary key,email text); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; create publication supabase_realtime;`);
  for (const file of ['001_household.sql','002_household_access.sql','003_merchant_category_rules.sql','004_snap_muse_integration.sql','005_dashboard_preferences.sql','006_purchase_reconciliation.sql','011_import_review_archive.sql','012_removed_import_review.sql']) {
    await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
  }
  await db.exec(`insert into auth.users values('${luke}','luke@example.com'); insert into public.members(id,name,role) values('${luke}','Luke','admin');`);
  await db.query(`select set_config('request.jwt.claim.sub',$1,false)`,[luke]);
  await db.query(`select public.server_save_item($1,$2,$3,$4,$5)`,['item','test-only-token','Robinhood','Luke',JSON.stringify(account)]);
  return db;
}

async function sync(db:PGlite,cursor:string,next:string,added:unknown[]=[],removed:unknown[]=[]){
  await db.query(`select public.server_apply_sync($1,$2,$3,$4,$5,$6,$7)`,['item',cursor,next,JSON.stringify(added),'[]',JSON.stringify(removed),JSON.stringify(account)]);
}

test('a removed posted purchase asks for review, then can be restored exactly once',async()=>{
  const db=await database();try{
    await sync(db,'','one',[posted]);
    await sync(db,'one','two',[],[{transaction_id:'posted'}]);
    assert.deepEqual((await db.query(`select removed,removal_review_state from public.transactions where id='posted'`)).rows,[{removed:true,removal_review_state:'open'}]);
    assert.equal((await db.query<{n:number}>(`select count(*)::int as n from public.assistant_spending where id='posted'`)).rows[0].n,0);
    await db.exec('set role authenticated');
    const restored=await db.query<{resolve_removed_import:string}>(`select public.resolve_removed_import($1,$2,$3)`,['posted','keep','household']);
    assert.ok(restored.rows[0].resolve_removed_import);
    assert.deepEqual((await db.query(`select merchant,date::text,amount_cents,account_id,category_id,source,removed from public.transactions where id=$1`,[restored.rows[0].resolve_removed_import])).rows,[{merchant:'Walmart',date:'2026-10-05',amount_cents:18529,account_id:'card',category_id:'household',source:'manual',removed:false}]);
    await assert.rejects(db.query(`select public.resolve_removed_import($1,$2,$3)`,['posted','keep','household']),/already reviewed/i);
    assert.equal((await db.query<{n:number}>(`select count(*)::int as n from public.transactions where source='manual' and not removed`)).rows[0].n,1);
  }finally{await db.close();}
});

test('normal pending-to-posted transition stays quiet, while a confirmed removal stays out of budget',async()=>{
  const db=await database();try{
    await sync(db,'','one',[{...posted,id:'pending',pending:true}]);
    await sync(db,'one','two',[{...posted,pending_transaction_id:'pending'}],[{transaction_id:'pending'}]);
    assert.equal((await db.query<{removal_review_state:string|null}>(`select removal_review_state from public.transactions where id='pending'`)).rows[0].removal_review_state,null);
    await sync(db,'two','three',[],[{transaction_id:'posted'}]);
    await db.exec('set role authenticated');
    await db.query(`select public.resolve_removed_import($1,$2,$3)`,['posted','dismiss',null]);
    assert.deepEqual((await db.query(`select removed,removal_review_state from public.transactions where id='posted'`)).rows,[{removed:true,removal_review_state:'dismissed'}]);
    assert.equal((await db.query<{n:number}>(`select count(*)::int as n from public.transactions where source='manual'`)).rows[0].n,0);
  }finally{await db.close();}
});

test('existing manual copy resolves a feed removal without creating another charge',async()=>{
  const db=await database();try{
    await sync(db,'','one',[posted]);
    await db.exec('set role authenticated');
    await db.query(`select public.household_action($1,$2,'member')`,['transaction',JSON.stringify({...posted,id:'manual',source:'manual',note:'Already entered'})]);
    await db.exec('reset role');
    await sync(db,'one','two',[],[{transaction_id:'posted'}]);
    assert.deepEqual((await db.query(`select removal_review_state,removal_manual_id from public.transactions where id='posted'`)).rows,[{removal_review_state:'recorded',removal_manual_id:'manual'}]);
    assert.equal((await db.query<{n:number}>(`select count(*)::int as n from public.transactions where source='manual' and not removed`)).rows[0].n,1);
  }finally{await db.close();}
});

test('viewers cannot resolve removed bank records',async()=>{
  const db=await database();try{
    await sync(db,'','one',[posted]);
    await sync(db,'one','two',[],[{transaction_id:'posted'}]);
    await db.exec(`insert into auth.users values('22222222-2222-2222-2222-222222222222','viewer@example.com'); insert into public.members(id,name,role) values('22222222-2222-2222-2222-222222222222','Viewer','viewer');`);
    await db.query(`select set_config('request.jwt.claim.sub',$1,false)`,['22222222-2222-2222-2222-222222222222']);
    await db.exec('set role authenticated');
    await assert.rejects(db.query(`select public.resolve_removed_import($1,$2,$3)`,['posted','keep','household']),/write access/i);
  }finally{await db.close();}
});

