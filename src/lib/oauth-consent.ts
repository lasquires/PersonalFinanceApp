export type AuthorizationState=
  |{kind:'loading'}
  |{kind:'signed-out';returnTo:string}
  |{kind:'forbidden'}
  |{kind:'error';message:string}
  |{kind:'redirect';url:string}
  |{kind:'ready';authorizationId:string;clientName:string;clientUri:string;scopes:string[]};

type Dependencies={getUser:()=>Promise<{id:string}|null>;getMemberRole:(id:string)=>Promise<string|null>;oauth:{getAuthorizationDetails:(id:string)=>Promise<any>;approveAuthorization:(id:string,options:object)=>Promise<any>;denyAuthorization:(id:string,options:object)=>Promise<any>}};

export async function loadAuthorizationState(authorizationId:string,returnTo:string,deps:Dependencies):Promise<AuthorizationState>{
  if(!authorizationId)return{kind:'error',message:'Authorization unavailable'};
  const user=await deps.getUser();
  if(!user)return{kind:'signed-out',returnTo};
  if(await deps.getMemberRole(user.id)!=='admin')return{kind:'forbidden'};
  const response=await deps.oauth.getAuthorizationDetails(authorizationId);
  if(response.error||!response.data)return{kind:'error',message:'Authorization unavailable'};
  if('redirect_url' in response.data)return{kind:'redirect',url:response.data.redirect_url};
  const details=response.data;
  return{kind:'ready',authorizationId:details.authorization_id,clientName:details.client.name,clientUri:details.client.uri,scopes:String(details.scope??'').split(/\s+/).filter(Boolean)};
}

export async function decideAuthorization(decision:'approve'|'deny',authorizationId:string,oauth:Dependencies['oauth']){const result=await (decision==='approve'?oauth.approveAuthorization(authorizationId,{skipBrowserRedirect:true}):oauth.denyAuthorization(authorizationId,{skipBrowserRedirect:true}));if(result.error||!result.data?.redirect_url)throw new Error('Authorization decision could not be completed');return result.data.redirect_url as string;}
