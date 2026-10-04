import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const actor='11111111-1111-4111-8111-111111111111';
const snapshot='22222222-2222-4222-8222-222222222222';
const hash='a'.repeat(64);
const exportedAt=new Date(Date.now()-7200000).toISOString();
const generatedAt=new Date(Date.now()-3600000).toISOString();
async function database(){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create publication supabase_realtime;`);
 for(const name of ['001_household','002_household_access','003_merchant_category_rules','004_snap_muse_integration','005_dashboard_preferences','006_purchase_reconciliation','007_financial_reviews'])await db.exec(await readFile(new URL('../supabase/migrations/'+name+'.sql',import.meta.url),'utf8'));
 await db.exec(`insert into auth.users values('${actor}','test@example.com');insert into members(id,name,role) values('${actor}','Luke','admin');select set_config('request.jwt.claim.sub','${actor}',false);`);
 await db.query('select public.server_rotate_review_token($1)',[hash]);
 await db.query('select public.server_record_review_snapshot($1,$2,$3,$4,$5,$6,$7,$8,$9)',[snapshot,'weekly','2026-09-28','2026-10-04',exportedAt,hash,JSON.stringify({warnings:[]}),null,hash]);
 return db;
}
function packet(revision=1){return {schema_version:1,snapshot_id:snapshot,report_key:'weekly:2026-09-28',revision,kind:'weekly',period_start:'2026-09-28',period_end:'2026-10-04',generated_at:generatedAt,title:'Review',overview:'Overview',tasks:[{task_key:'gas-plan',title:'Compare gas prices',priority:'Normal',assignee:'Together',due_date:null,impact_cents:0,impact_type:'once',notes:'Chat suggestion',basis:'suggested'}]};}
async function deliver(db:PGlite,p=packet(),content='b'.repeat(64)){return (await db.query<{result:any}>('select public.server_save_financial_review($1,$2,$3,$4) result',[JSON.stringify(p),content,null,hash])).rows[0].result;}
test('atomic review delivery replays, rejects conflicts, and preserves existing tasks on revisions',async()=>{
 const db=await database();try{
 const r=await deliver(db); assert.equal(r.tasks_created,1);assert.equal(r.replayed,false);
 assert.equal((await deliver(db)).delivery_id,r.delivery_id);
 await assert.rejects(deliver(db,packet(),'c'.repeat(64)),/conflict/i);
 await db.query("update tasks set status='Done',notes='Household edited' where id=$1",[ (await db.query<{task_id:string}>('select task_id from financial_review_task_links')).rows[0].task_id]);
 const next=await deliver(db,packet(2),'c'.repeat(64));assert.equal(next.tasks_created,0);assert.equal(next.tasks_linked,1);
 const tasks=(await db.query<{status:string;notes:string}>("select status,notes from tasks where suggestion_key='review:gas-plan'")).rows;
 assert.deepEqual(tasks,[{status:'Done',notes:'Household edited'}]);
 await assert.rejects(deliver(db,packet(4),'d'.repeat(64)),/revision/i);
 }finally{await db.close();}
});
test('invalid links roll back all rows, credentials are scoped and revocable, and viewers cannot write',async()=>{
 const db=await database();try{
 const p=packet();(p.tasks[0] as any).category_id='unknown';
 await assert.rejects(deliver(db,p),/category/i);
 assert.equal((await db.query<{n:number}>('select count(*)::int n from financial_reviews')).rows[0].n,0);
 assert.equal((await db.query<{n:number}>('select count(*)::int n from review_delivery_receipts')).rows[0].n,0);
 const viewer='33333333-3333-4333-8333-333333333333';
 await db.exec(`insert into auth.users values('${viewer}','viewer@example.com');insert into members(id,name,role) values('${viewer}','Viewer','viewer');select set_config('request.jwt.claim.sub','${viewer}',false);`);
 await assert.rejects(db.query('select public.server_save_financial_review($1,$2,$3,$4)',[JSON.stringify(packet()),'b'.repeat(64),viewer,null]),/access/i);
 await db.exec('set role authenticated');
 await assert.rejects(db.query('select * from review_courier_tokens'),/permission/i);
 await assert.rejects(db.query('select public.server_rotate_review_token($1)',[hash]),/permission/i);
 await db.exec('reset role');await db.query('select public.server_revoke_review_token()');
 await assert.rejects(deliver(db),/Unauthorized/);
 }finally{await db.close();}
});
test('rate reservation is bounded and task equivalents link or warn without reopening',async()=>{
 const db=await database();try{
 for(let i=0;i<30;i++)await db.query('select public.server_reserve_review_request($1,$2,$3)',[null,hash,'export']);
 await assert.rejects(db.query('select public.server_reserve_review_request($1,$2,$3)',[null,hash,'export']),/rate/i);
 await db.exec("insert into tasks(id,title,assignee,status) values('existing','Compare gas prices','Together','Active')");
 assert.equal((await deliver(db)).tasks_linked,1);
 const p=packet(2);p.tasks[0].task_key='changed-key';await db.exec("update tasks set status='Done' where id='existing'");
 const result=await deliver(db,p,'d'.repeat(64));assert.equal(result.tasks_created,0);assert.ok(result.warnings.some((w:string)=>/completed|dismissed/i.test(w)));
 }finally{await db.close();}
});
test('service role can read the exact source tables and use the delivery RPC',async()=>{
 const db=await database();try{
  await db.exec('set role service_role');
  for(const table of ['settings','categories','monthly_limits','transactions','accounts','tasks','financial_events','reservoir_entries','snap_balance_snapshots'])await db.query(`select * from public.${table} limit 1`);
  const result=await deliver(db);assert.equal(result.tasks_created,1);
 }finally{await db.close();}
});
