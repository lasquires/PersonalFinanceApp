import test from 'node:test';
import assert from 'node:assert/strict';
import { handleMcpRequest, toolNames } from '../src/lib/server/mcp-tools';

function db(){
  const rows:any={assistant_monthly_budget:[{category_id:'dates',name:'Dates',group:'flexible',rollover:false,budget_cents:10000,carried_cents:0,spent_cents:7600,remaining_cents:2400}],assistant_spending:[],assistant_attention:[],tips:[],assistant_upcoming_events:[]};
  const state={lastRpc:''};
  const client:any={from(table:string){const builder:any={select(){return builder;},gte(){return builder;},lte(){return builder;},order(){return builder;},limit(){return Promise.resolve({data:rows[table]??[],error:null});}};return builder;},async rpc(name:string){state.lastRpc=name;return{data:{id:'created'},error:null};}};
  return{client,state};
}
async function call(method:string,params?:unknown,id=1){const fixture=db();const request=new Request('https://app.test/api/mcp',{method:'POST',headers:{'content-type':'application/json','accept':'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id,method,params})});const response=await handleMcpRequest(request,{actorId:'actor',clientId:'chatgpt',db:fixture.client});return{response,body:await response.json(),state:fixture.state};}

test('MCP initializes and exposes exactly the approved tools',async()=>{
  const initialized=await call('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'test',version:'1'}});
  assert.equal(initialized.response.status,200);
  const listed=await call('tools/list',{});
  assert.deepEqual(listed.body.result.tools.map((tool:{name:string})=>tool.name),toolNames);
});

test('MCP reads stay bounded and outputs do not expose credentials',async()=>{
  const result=await call('tools/call',{name:'review_week',arguments:{}});
  const serialized=JSON.stringify(result.body).toLowerCase();
  assert.equal(result.body.result.isError,undefined);
  for(const forbidden of ['access_token','service_role','plaid','bearer secret'])assert.equal(serialized.includes(forbidden),false);
});

test('MCP validates malformed writes and routes valid writes through assistant services',async()=>{
  const invalid=await call('tools/call',{name:'create_tip',arguments:{title:'Missing body'}});
  assert.equal(invalid.body.result.isError,true);
  const valid=await call('tools/call',{name:'create_tip',arguments:{title:'Keep going',body:'Review the weekly plan.',evidence:{remaining_cents:2400}}});
  assert.equal(valid.state.lastRpc,'assistant_create_tip');
});
