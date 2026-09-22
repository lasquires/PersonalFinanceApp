import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSuggestedTask,
  createTip,
  evidenceSchema,
  listRecentTransactions,
  suggestedTaskSchema,
  tipSchema,
} from '../src/lib/server/assistant';

const context = { actorId:'11111111-1111-1111-1111-111111111111', clientId:'chatgpt', toolName:'create_tip' };

function fakeDb() {
  const state:{lastRpc:string;lastArgs:Record<string,unknown>;lastTable:string;filters:unknown[]}= { lastRpc:'',lastArgs:{},lastTable:'',filters:[] };
  const rows = [{ id:'transaction-1',date:'2026-09-20',merchant:'Market',category_id:'household',amount_cents:2500,pending:false }];
  const builder:any = {
    select(){return builder;}, gte(...args:unknown[]){state.filters.push(args);return builder;}, order(){return builder;}, limit(value:number){state.filters.push(['limit',value]);return Promise.resolve({data:rows,error:null});},
  };
  return Object.assign(state, {
    from(table:string){state.lastTable=table;return builder;},
    async rpc(name:string,args:Record<string,unknown>){state.lastRpc=name;state.lastArgs=args;return {data:{id:'created'},error:null};},
  });
}

test('assistant read requests are bounded', async () => {
  const db=fakeDb();
  const recent=await listRecentTransactions(db as never,{days:5000,limit:5000},new Date('2026-09-22T12:00:00Z'));
  assert.deepEqual(recent.query,{days:90,limit:100});
  assert.equal(db.lastTable,'assistant_spending');
  assert.ok(db.filters.some(filter=>Array.isArray(filter)&&filter[0]==='limit'&&filter[1]===100));
});

test('assistant tip writes use the constrained audited RPC', async () => {
  const db=fakeDb();
  await createTip(db as never,{title:'Protect the date budget',body:'You have $24 left this month.',evidence:{category:'Dates',remaining_cents:2400},expires_at:'2026-10-01'},context);
  assert.equal(db.lastRpc,'assistant_create_tip');
  assert.equal(db.lastArgs.oauth_client_id,'chatgpt');
  assert.equal(db.lastArgs.tool_name,'create_tip');
});

test('assistant evidence rejects nested arrays, secret-like keys, and more than 20 keys', () => {
  assert.throws(()=>evidenceSchema.parse({items:[1,2]}));
  assert.throws(()=>evidenceSchema.parse({access_token:'hidden'}));
  assert.throws(()=>evidenceSchema.parse(Object.fromEntries(Array.from({length:21},(_,index)=>[`key_${index}`,index]))));
});

test('assistant write schemas enforce small tips and suggested tasks', () => {
  assert.throws(()=>tipSchema.parse({title:'x'.repeat(121),body:'ok',evidence:{}}));
  assert.throws(()=>tipSchema.parse({title:'ok',body:'x'.repeat(801),evidence:{}}));
  assert.throws(()=>suggestedTaskSchema.parse({title:'Do it',status:'Active'}));
});

test('assistant task writes force Suggested and pass linked IDs to validation RPC', async () => {
  const db=fakeDb();
  await createSuggestedTask(db as never,{title:'Check the date budget',category_id:'dates',event_id:'event-1'},{...context,toolName:'create_task'});
  assert.equal(db.lastRpc,'assistant_create_suggested_task');
  const payload=db.lastArgs.payload as Record<string,unknown>;
  assert.equal(payload.status,'Suggested');
  assert.equal(payload.category_id,'dates');
  assert.equal(payload.event_id,'event-1');
});
