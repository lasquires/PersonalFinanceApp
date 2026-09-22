import test from 'node:test';
import assert from 'node:assert/strict';
import { authenticateBearer, protectedResourceMetadata } from '../src/lib/server/oauth';

function request(token?:string){return new Request('https://squires-family-finance.vercel.app/api/mcp',{headers:token?{authorization:`Bearer ${token}`}:{}});}
function deps(role:'admin'|'member'|'viewer'|null='admin',clientId='chatgpt'){
  const db:any={
    auth:{
      async getUser(token:string){return token==='valid'?{data:{user:{id:'11111111-1111-1111-1111-111111111111'}},error:null}:{data:{user:null},error:{message:'bad token'}};},
      async getClaims(){return{data:{claims:{client_id:clientId}},error:null};},
    },
    from(){return{select(){return this;},eq(){return this;},async single(){return role?{data:{id:'11111111-1111-1111-1111-111111111111',name:'Luke',email:'luke@example.com',role},error:null}:{data:null,error:{message:'missing'}};}};},
  };
  return{createClient:()=>db,supabaseUrl:'https://project.supabase.co',publishableKey:'publishable'};
}

test('OAuth bearer authentication rejects missing and malformed tokens',async()=>{
  await assert.rejects(authenticateBearer(request(),deps() as never),/Bearer token required/);
  await assert.rejects(authenticateBearer(request('invalid'),deps() as never),/Bearer token invalid/);
});

test('OAuth bearer authentication requires current admin membership and client id',async()=>{
  const context=await authenticateBearer(request('valid'),deps('admin') as never);
  assert.equal(context.actorId,'11111111-1111-1111-1111-111111111111');
  assert.equal(context.clientId,'chatgpt');
  await assert.rejects(authenticateBearer(request('valid'),deps('viewer') as never),/Administrator access required/);
  await assert.rejects(authenticateBearer(request('valid'),deps(null) as never),/Administrator access required/);
  await assert.rejects(authenticateBearer(request('valid'),deps('admin','') as never),/OAuth client identity required/);
});

test('protected resource metadata identifies Supabase authorization server',()=>{
  assert.deepEqual(protectedResourceMetadata('https://squires-family-finance.vercel.app','https://tcrbcqrsafuckhsknfoy.supabase.co'),{
    resource:'https://squires-family-finance.vercel.app/api/mcp',
    authorization_servers:['https://tcrbcqrsafuckhsknfoy.supabase.co/auth/v1'],
    bearer_methods_supported:['header'],
  });
});
