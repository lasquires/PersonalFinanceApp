import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { dashboardPreferencesSchema, defaultDashboardPreferences, parseDashboardPreferences } from '../src/lib/dashboard-preferences';

test('dashboard preference validation preserves explicit empty selections and order', () => {
  assert.deepEqual(parseDashboardPreferences({sections:['accounts','spending'],account_ids:[],category_ids:['gas']}), {sections:['accounts','spending'],account_ids:[],category_ids:['gas']});
  assert.deepEqual(parseDashboardPreferences({sections:[],account_ids:null,category_ids:null}), {sections:[],account_ids:null,category_ids:null});
  assert.deepEqual(parseDashboardPreferences(null), defaultDashboardPreferences());
  assert.equal(dashboardPreferencesSchema.safeParse({sections:['accounts','accounts'],account_ids:null,category_ids:null}).success, false);
  assert.equal(dashboardPreferencesSchema.safeParse({sections:['unknown'],account_ids:null,category_ids:null}).success, false);
});

test('personal dashboard preferences persist for viewers and are isolated by login', async () => {
  const db = new PGlite();
  const luke = '11111111-1111-1111-1111-111111111111';
  const samantha = '22222222-2222-2222-2222-222222222222';
  const outsider = '33333333-3333-3333-3333-333333333333';
  try {
    await db.exec(`create role anon;create role authenticated;create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create table public.members (id uuid primary key,role text);
      create function public.is_member() returns boolean language sql stable security definer as $$ select exists(select 1 from public.members where id=auth.uid()) $$;
      insert into public.members values ('${luke}','admin'),('${samantha}','viewer');`);
    await db.exec(await readFile(new URL('../supabase/migrations/005_dashboard_preferences.sql',import.meta.url),'utf8'));
    await db.query(`select set_config('request.jwt.claim.sub',$1,false)`,[luke]);
    await db.exec('set role authenticated');
    await db.query(`insert into public.dashboard_preferences(user_id,sections,account_ids,category_ids) values($1,array['accounts','spending'],null,array['gas'])`,[luke]);
    await assert.rejects(db.query(`insert into public.dashboard_preferences(user_id) values($1)`,[samantha]),/row-level security/);
    await db.query(`select set_config('request.jwt.claim.sub',$1,false)`,[samantha]);
    assert.equal((await db.query('select * from public.dashboard_preferences')).rows.length,0);
    await db.query(`insert into public.dashboard_preferences(user_id,sections) values($1,array['tasks'])`,[samantha]);
    await db.query(`update public.dashboard_preferences set sections=array['snap','tasks'] where user_id=$1`,[samantha]);
    await db.query(`update public.dashboard_preferences set sections=array['snap'] where user_id=$1`,[luke]);
    await db.query(`select set_config('request.jwt.claim.sub',$1,false)`,[luke]);
    assert.deepEqual((await db.query<{sections:string[]}>('select sections from public.dashboard_preferences')).rows,[{sections:['accounts','spending']}]);
    await assert.rejects(db.query(`update public.dashboard_preferences set sections=array['invalid'] where user_id=$1`,[luke]),/known_dashboard_sections/);
    await db.query(`select set_config('request.jwt.claim.sub',$1,false)`,[outsider]);
    assert.equal((await db.query('select * from public.dashboard_preferences')).rows.length,0);
    await assert.rejects(db.query(`insert into public.dashboard_preferences(user_id) values($1)`,[outsider]),/row-level security/);
  } finally {await db.close();}
});
