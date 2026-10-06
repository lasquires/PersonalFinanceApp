import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

async function database() {
  const db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key,email text); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; create publication supabase_realtime;");
  for (const name of ['001_household', '002_household_access', '003_merchant_category_rules', '004_snap_muse_integration', '005_dashboard_preferences', '006_purchase_reconciliation', '007_financial_reviews', '008_public_snap_observations']) {
    await db.exec(await readFile(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), 'utf8'));
  }
  return db;
}

async function receive(db: PGlite, cents: number, time: string, ip = 'a'.repeat(64)) {
  return (await db.query<{ result: string }>('select public.server_receive_public_snap($1,$2,$3,$4) result', ['2026-10-01', cents, time, ip])).rows[0].result;
}

test('public observations never change trusted balance, reject older data and flag large increases', async () => {
  const db = await database();
  try {
    await db.query('select public.server_save_snap_balance($1,$2,$3)', ['2026-10-01', 19000, '2026-10-05T10:00:00Z']);
    assert.equal(await receive(db, 18000, '2026-10-05T11:00:00Z'), 'updated');
    assert.equal(await receive(db, 17000, '2026-10-05T10:30:00Z'), 'unchanged');
    assert.equal(await receive(db, 78001, '2026-10-05T12:00:00Z'), 'flagged');
    assert.equal((await db.query<{ balance_cents: number }>("select balance_cents from snap_public_observations where id='2026-10:accepted'")).rows[0].balance_cents, 18000);
    assert.equal((await db.query<{ balance_cents: number }>("select balance_cents from snap_public_observations where id='2026-10:flagged'")).rows[0].balance_cents, 78001);
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
