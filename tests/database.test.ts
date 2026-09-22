import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

async function database(beforeSecond?: (db: PGlite) => Promise<void>) {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create publication supabase_realtime;
  `);
  const migration = await readFile(new URL('../supabase/migrations/001_household.sql', import.meta.url), 'utf8');
  await db.exec(migration);
  await beforeSecond?.(db);
  const second = await readFile(new URL('../supabase/migrations/002_household_access.sql', import.meta.url), 'utf8').catch(() => '');
  if (second) await db.exec(second);
  return db;
}

const LUKE = '11111111-1111-1111-1111-111111111111';
const SAMANTHA = '22222222-2222-2222-2222-222222222222';
const GUEST = '33333333-3333-3333-3333-333333333333';

async function seededMembers(db: PGlite) {
  await db.exec(`
    insert into auth.users(id) values ('${LUKE}'),('${SAMANTHA}'),('${GUEST}');
    insert into public.members(id,name) values ('${LUKE}','Luke'),('${SAMANTHA}','Samantha');
  `);
}

test('roles preserve both household admins and enforce viewer/member boundaries', async () => {
  const db = await database(seededMembers);
  const members = await db.query<{name:string;role:string}>(`select name,role from public.members order by name`);
  assert.deepEqual(members.rows, [{ name:'Luke', role:'admin' }, { name:'Samantha', role:'admin' }]);

  await db.query(`insert into public.members(id,name,email,role) values($1,'Guest','guest@example.com','viewer')`, [GUEST]);
  await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [GUEST]);
  await db.exec(`set role authenticated`);
  const visible = await db.query(`select category_id from public.assistant_monthly_budget limit 1`);
  assert.equal(visible.rows.length, 1);
  await assert.rejects(
    db.query(`select public.household_action('task',$1,'member')`, [JSON.stringify({ title:'Nope', status:'Active', priority:'Normal', assignee:'Together', impact_cents:0, impact_type:'once', notes:'' })]),
    /Household write access required/,
  );

  await db.exec(`reset role`);
  await db.query(`update public.members set role='member' where id=$1`, [GUEST]);
  await db.exec(`set role authenticated`);
  await db.query(`select public.household_action('task',$1,'member')`, [JSON.stringify({ title:'Allowed', status:'Active', priority:'Normal', assignee:'Together', impact_cents:0, impact_type:'once', notes:'' })]);
  await assert.rejects(db.query(`update public.members set role='admin' where id=$1`, [GUEST]));
  await db.exec(`reset role`);
  await db.close();
});

test('database never permits removing or demoting the final admin', async () => {
  const db = await database(seededMembers);
  await db.query(`delete from public.members where id=$1`, [SAMANTHA]);
  await assert.rejects(
    db.query(`update public.members set role='viewer' where id=$1`, [LUKE]),
    /Household must retain an admin/,
  );
  await assert.rejects(
    db.query(`delete from public.members where id=$1`, [LUKE]),
    /Household must retain an admin/,
  );
  await db.close();
});

test('migration protects Plaid tokens and defines RLS for every exposed table', async () => {
  const db = await database();
  const tokenTable = await db.query<{ table_schema: string }>(`
    select table_schema from information_schema.tables where table_name='plaid_items'
  `);
  assert.deepEqual(tokenTable.rows, [{ table_schema: 'private' }]);
  const publicTokenColumns = await db.query(`
    select table_name from information_schema.columns
    where table_schema='public' and column_name in ('access_token','secret','service_role_key')
  `);
  assert.equal(publicTokenColumns.rows.length, 0);
  const exposed = ['members','categories','monthly_limits','accounts','transactions','tasks','financial_events','reservoir_entries','settings','audit_log'];
  const rls = await db.query<{ relname: string; relrowsecurity: boolean }>(`
    select relname, relrowsecurity from pg_class where relname = any($1)
  `, [exposed]);
  assert.equal(rls.rows.length, exposed.length);
  assert.ok(rls.rows.every(row => row.relrowsecurity));
  await db.close();
});

test('pending to posted sync leaves exactly one budgeted purchase', async () => {
  const db = await database();
  const account = [{ account_id: 'account-1', name: 'Checking', mask: '1234', type: 'depository', balances: { current: 1000 } }];
  await db.query(`select public.server_save_item($1,$2,$3,$4,$5)`, ['item-1','secret-token','Test Bank','Luke',JSON.stringify(account)]);
  const pending = [{ id:'pending-1', account_id:'account-1', merchant:'Market', date:'2026-09-20', amount_cents:2500, category_id:'household', kind:'expense', pending:true, pending_transaction_id:null, currency:'USD', needs_review:false }];
  const first = await db.query<{ server_apply_sync: boolean }>(`select public.server_apply_sync($1,$2,$3,$4,$5,$6,$7)`, ['item-1','','cursor-1',JSON.stringify(pending),'[]','[]',JSON.stringify(account)]);
  assert.equal(first.rows[0].server_apply_sync, true);
  const posted = [{ ...pending[0], id:'posted-1', pending:false, pending_transaction_id:'pending-1' }];
  const second = await db.query<{ server_apply_sync: boolean }>(`select public.server_apply_sync($1,$2,$3,$4,$5,$6,$7)`, ['item-1','cursor-1','cursor-2','[]',JSON.stringify(posted),'[]',JSON.stringify(account)]);
  assert.equal(second.rows[0].server_apply_sync, true);
  const transactions = await db.query<{ id:string; removed:boolean }>(`select id,removed from public.transactions order by id`);
  assert.deepEqual(transactions.rows, [{ id:'pending-1', removed:true }, { id:'posted-1', removed:false }]);
  const spending = await db.query<{ total:bigint }>(`select sum(amount_cents)::bigint total from public.assistant_spending`);
  assert.equal(Number(spending.rows[0].total), 2500);
  await db.close();
});

test('cursor compare-and-swap rejects a stale concurrent sync', async () => {
  const db = await database();
  const account = [{ account_id: 'account-1', name: 'Checking', mask: '1234', type: 'depository', balances: { current: 1000 } }];
  await db.query(`select public.server_save_item($1,$2,$3,$4,$5)`, ['item-1','secret-token','Test Bank','Luke',JSON.stringify(account)]);
  const first = await db.query<{ server_apply_sync:boolean }>(`select public.server_apply_sync($1,$2,$3,$4,$5,$6,$7)`, ['item-1','','cursor-1','[]','[]','[]',JSON.stringify(account)]);
  const stale = await db.query<{ server_apply_sync:boolean }>(`select public.server_apply_sync($1,$2,$3,$4,$5,$6,$7)`, ['item-1','','cursor-stale','[]','[]','[]',JSON.stringify(account)]);
  assert.equal(first.rows[0].server_apply_sync, true);
  assert.equal(stale.rows[0].server_apply_sync, false);
  await db.close();
});

test('assistant views expose current budget, runway inputs, and sync health without secrets', async () => {
  const db = await database();
  const views = await db.query<{ table_name:string }>(`
    select table_name from information_schema.views where table_schema='public' and table_name like 'assistant_%'
  `);
  const names = new Set(views.rows.map(row => row.table_name));
  for (const name of ['assistant_monthly_budget','assistant_runway_inputs','assistant_account_health','assistant_attention','assistant_upcoming_events']) assert.ok(names.has(name));
  const columns = await db.query<{ column_name:string }>(`
    select column_name from information_schema.columns where table_schema='public' and table_name like 'assistant_%'
  `);
  assert.ok(!columns.rows.some(row => ['access_token','secret','service_role_key'].includes(row.column_name)));
  const budget = await db.query<{ category_id:string; remaining_cents:bigint }>(`select category_id,remaining_cents from public.assistant_monthly_budget where category_id='luke'`);
  assert.equal(Number(budget.rows[0].remaining_cents), 5000);
  await db.close();
});
