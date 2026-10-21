import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

async function database(includeRefill = true) {
  const db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key,email text); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; create publication supabase_realtime;");
  for (const name of ['001_household', '002_household_access', '003_merchant_category_rules', '004_snap_muse_integration', '005_dashboard_preferences', '006_purchase_reconciliation', '007_financial_reviews', '008_public_snap_observations', ...(includeRefill?['013_snap_refill_approval']:[])]) {
    await db.exec(await readFile(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), 'utf8'));
  }
  return db;
}

test('migration accepts the current month held refill under $1000', async () => {
  const db=await database(false);
  try {
    await db.exec(`insert into public.snap_public_observations(id,benefit_month,balance_cents,observed_at,flagged) values
      ('accepted',date_trunc('month',now() at time zone 'America/New_York')::date,7195,now()-interval '2 hours',false),
      ('flagged',date_trunc('month',now() at time zone 'America/New_York')::date,87995,now()-interval '1 hour',true);`);
    await db.exec(await readFile(new URL('../supabase/migrations/013_snap_refill_approval.sql',import.meta.url),'utf8'));
    assert.deepEqual((await db.query(`select balance_cents,flagged from public.snap_public_observations order by flagged`)).rows,[{balance_cents:87995,flagged:false},{balance_cents:87995,flagged:true}]);
    assert.equal((await db.query<{n:number}>(`select count(*)::int n from public.snap_refill_acceptances`)).rows[0].n,1);
  } finally {await db.close();}
});

test('an admin can confirm a held refill once; public and viewer roles cannot', async () => {
  const db = await database();
  try {
    await db.exec(`insert into auth.users values('11111111-1111-1111-1111-111111111111','luke@example.com'),('22222222-2222-2222-2222-222222222222','viewer@example.com'); insert into public.members(id,name,role) values('11111111-1111-1111-1111-111111111111','Luke','admin'),('22222222-2222-2222-2222-222222222222','Samantha','viewer');`);
    await receive(db, 7195, '2026-10-21T03:34:00Z');
    assert.equal(await receive(db, 107195, '2026-10-21T20:05:00Z'), 'flagged');
    await db.exec('set role anon');
    await assert.rejects(db.query(`select public.approve_snap_refill($1,$2,$3)`, ['2026-10-01', 107195, '2026-10-21T20:05:00Z']), /permission/i);
    await db.exec('reset role');
    await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, ['22222222-2222-2222-2222-222222222222']);
    await db.exec('set role authenticated');
    await assert.rejects(db.query(`select public.approve_snap_refill($1,$2,$3)`, ['2026-10-01', 107195, '2026-10-21T20:05:00Z']), /admin/i);
    await db.exec('reset role');
    await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, ['11111111-1111-1111-1111-111111111111']);
    await db.exec('set role authenticated');
    await assert.rejects(db.query(`select public.approve_snap_refill($1,$2,$3)`, ['2026-10-01', 88000, '2026-10-21T20:05:00Z']), /changed/i);
    await db.query(`select public.approve_snap_refill($1,$2,$3)`, ['2026-10-01', 107195, '2026-10-21T20:05:00Z']);
    assert.deepEqual((await db.query(`select balance_cents,source from public.snap_balance_snapshots where id='2026-10'`)).rows,[{balance_cents:107195,source:'household'}]);
    assert.equal((await db.query<{n:number}>(`select count(*)::int as n from public.snap_public_observations where flagged`)).rows[0].n,1);
    await assert.rejects(db.query(`select public.approve_snap_refill($1,$2,$3)`, ['2026-10-01', 107195, '2026-10-21T20:05:00Z']), /changed/i);
  } finally { await db.close(); }
});

test('one under-$1000 benefit refill per month is accepted, then normal spending continues', async () => {
  const db=await database();
  try {
    assert.equal(await receive(db,7195,'2026-10-21T03:34:00Z'),'updated');
    assert.equal(await receive(db,87995,'2026-10-21T20:05:00Z'),'updated');
    assert.deepEqual((await db.query(`select balance_cents,flagged from public.snap_public_observations order by flagged`)).rows,[{balance_cents:87995,flagged:false},{balance_cents:87995,flagged:true}]);
    assert.equal(await receive(db,85995,'2026-10-21T21:05:00Z'),'updated');
    assert.equal(await receive(db,146995,'2026-10-21T22:05:00Z'),'flagged');
    assert.equal((await db.query<{n:number}>(`select count(*)::int n from public.snap_refill_acceptances where benefit_month='2026-10-01'`)).rows[0].n,1);
  } finally {await db.close();}
});

async function receive(db: PGlite, cents: number, time: string, ip = 'a'.repeat(64)) {
  return (await db.query<{ result: string }>('select public.server_receive_public_snap($1,$2,$3,$4) result', ['2026-10-01', cents, time, ip])).rows[0].result;
}

test('public observations never change trusted balance, reject older data and flag large increases', async () => {
  const db = await database();
  try {
    await db.query('select public.server_save_snap_balance($1,$2,$3)', ['2026-10-01', 19000, '2026-10-05T10:00:00Z']);
    assert.equal(await receive(db, 18000, '2026-10-05T11:00:00Z'), 'updated');
    assert.equal(await receive(db, 17000, '2026-10-05T10:30:00Z'), 'unchanged');
    assert.equal(await receive(db, 128001, '2026-10-05T12:00:00Z'), 'flagged');
    assert.equal((await db.query<{ balance_cents: number }>("select balance_cents from snap_public_observations where id='2026-10:accepted'")).rows[0].balance_cents, 18000);
    assert.equal((await db.query<{ balance_cents: number }>("select balance_cents from snap_public_observations where id='2026-10:flagged'")).rows[0].balance_cents, 128001);
    assert.equal((await db.query<{ balance_cents: number }>("select balance_cents from snap_balance_snapshots where id='2026-10'")).rows[0].balance_cents, 19000);
  } finally { await db.close(); }
});

test('database rate limits atomically and restricts public table access', async () => {
  const db = await database();
  try {
    const when = '2026-10-05T11:00:00Z';
    for (let i = 0; i < 10; i++) assert.ok(['updated', 'unchanged'].includes(await receive(db, 18000, when)));
    assert.equal(await receive(db, 18000, when), 'rate_limited');
    await db.exec('set role anon');
    await assert.rejects(db.query('select * from snap_public_observations'), /permission/i);
    await assert.rejects(db.query('select public.server_receive_public_snap($1,$2,$3,$4)', ['2026-10-01', 1, when, 'b'.repeat(64)]), /permission/i);
  } finally { await db.close(); }
});

test('hourly limit rejects a new minute when 100 requests were already counted', async () => {
  const db = await database();
  try {
    const ip = 'c'.repeat(64);
    await db.query("insert into snap_public_rate_limits(client_hash,window_start,window_seconds,hits) values($1,date_trunc('hour',now()),3600,100)", [ip]);
    assert.equal(await receive(db, 18000, '2026-10-05T11:00:00Z', ip), 'rate_limited');
    assert.equal((await db.query<{ n: number }>('select count(*)::int n from snap_public_observations')).rows[0].n, 0);
  } finally { await db.close(); }
});

