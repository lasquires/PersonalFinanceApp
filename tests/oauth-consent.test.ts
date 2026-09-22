import test from 'node:test';
import assert from 'node:assert/strict';
import { decideAuthorization, loadAuthorizationState } from '../src/lib/oauth-consent';

function dependencies(options:{signedIn?:boolean;role?:string;details?:any;error?:boolean}={}){
  const details=options.details??{authorization_id:'authorization-1',redirect_uri:'https://chatgpt.com/callback',client:{id:'client-1',name:'ChatGPT',uri:'https://chatgpt.com',logo_uri:''},user:{id:'user-1',email:'luke@example.com'},scope:'openid email'};
  const oauth={
    async getAuthorizationDetails(){return options.error?{data:null,error:{message:'expired'}}:{data:details,error:null};},
    async approveAuthorization(){return{data:{redirect_url:'https://chatgpt.com/callback?code=approved'},error:null};},
    async denyAuthorization(){return{data:{redirect_url:'https://chatgpt.com/callback?error=access_denied'},error:null};},
  };
  return{
    getUser:async()=>options.signedIn===false?null:{id:'user-1'},
    getMemberRole:async()=>options.role??'admin',oauth,
  };
}

test('OAuth consent preserves the request when sign-in is required',async()=>{
  const state=await loadAuthorizationState('authorization-1','https://app.test/authorize?authorization_id=authorization-1',dependencies({signedIn:false}));
  assert.deepEqual(state,{kind:'signed-out',returnTo:'https://app.test/authorize?authorization_id=authorization-1'});
});

test('OAuth consent denies non-admins and handles malformed requests safely',async()=>{
  assert.equal((await loadAuthorizationState('authorization-1','https://app.test/authorize',dependencies({role:'viewer'}))).kind,'forbidden');
  assert.equal((await loadAuthorizationState('','https://app.test/authorize',dependencies())).kind,'error');
  assert.equal((await loadAuthorizationState('authorization-1','https://app.test/authorize',dependencies({error:true}))).kind,'error');
});

test('OAuth consent shows only verified client details and scopes',async()=>{
  const state=await loadAuthorizationState('authorization-1','https://app.test/authorize',dependencies());
  assert.equal(state.kind,'ready');
  if(state.kind==='ready')assert.deepEqual({name:state.clientName,scopes:state.scopes},{name:'ChatGPT',scopes:['openid','email']});
  assert.equal(JSON.stringify(state).includes('client_secret'),false);
});

test('OAuth consent approval and denial return SDK-verified redirect URLs',async()=>{
  assert.match(await decideAuthorization('approve','authorization-1',dependencies().oauth),/code=approved/);
  assert.match(await decideAuthorization('deny','authorization-1',dependencies().oauth),/access_denied/);
});
