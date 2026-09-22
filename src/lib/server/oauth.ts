import { createClient as createSupabaseClient } from '@supabase/supabase-js';

type OAuthDependencies={createClient:(url:string,key:string,options:object)=>any;supabaseUrl?:string;publishableKey?:string};
export type AuthenticatedAssistant={actorId:string;clientId:string;member:{id:string;name:string;email:string|null;role:'admin'};db:any};

export async function authenticateBearer(request:Request,deps:OAuthDependencies={createClient:createSupabaseClient}) : Promise<AuthenticatedAssistant>{
  const authorization=request.headers.get('authorization')??'';
  const match=/^Bearer\s+(.+)$/i.exec(authorization);
  if(!match)throw new Error('Bearer token required');
  const url=deps.supabaseUrl??process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=deps.publishableKey??process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if(!url||!key)throw new Error('OAuth resource server is not configured');
  const db=deps.createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:`Bearer ${match[1]}`}}});
  const userResult=await db.auth.getUser(match[1]);
  if(userResult.error||!userResult.data.user)throw new Error('Bearer token invalid');
  const claimsResult=await db.auth.getClaims(match[1]);
  const clientId=claimsResult.data?.claims?.client_id;
  if(typeof clientId!=='string'||!clientId.trim())throw new Error('OAuth client identity required');
  const memberResult=await db.from('members').select('id,name,email,role').eq('id',userResult.data.user.id).single();
  if(memberResult.error||memberResult.data?.role!=='admin')throw new Error('Administrator access required');
  return{actorId:userResult.data.user.id,clientId,member:memberResult.data,db};
}

export function protectedResourceMetadata(appUrl:string,supabaseUrl:string){return{resource:`${appUrl.replace(/\/$/,'')}/api/mcp`,authorization_servers:[`${supabaseUrl.replace(/\/$/,'')}/auth/v1`],bearer_methods_supported:['header']};}
