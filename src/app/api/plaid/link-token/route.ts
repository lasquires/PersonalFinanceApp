import { NextResponse } from 'next/server';
import { CountryCode, Products } from 'plaid';
import { requireMember } from '@/lib/server/auth';
import { items, plaid } from '@/lib/server/plaid';
export async function POST(request:Request) {
 try {const {user,member}=await requireMember(request);const body=await request.json().catch(()=>({}));const all=await items();const item=body.item_id?all.find(i=>i.id===body.item_id):undefined;if(body.item_id&&!item)return NextResponse.json({error:'Connection not found'},{status:404});
 if(!item&&all.length>=Number(process.env.PLAID_MAX_ITEMS??5))return NextResponse.json({error:'Connection limit reached. Review your free plan before adding more.'},{status:409});
 const appUrl=process.env.APP_URL;const {data}=await plaid().linkTokenCreate({user:{client_user_id:user.id},client_name:'Squires Family Finance',language:'en',country_codes:[CountryCode.Us],...(item?{access_token:item.access_token}:{products:[Products.Transactions],transactions:{days_requested:180}}),...(appUrl?.startsWith('https://')?{webhook:appUrl+'/api/plaid/webhook',redirect_uri:appUrl+'/oauth'}:{})});
 return NextResponse.json({link_token:data.link_token,member:member.name,environment:process.env.PLAID_ENV??'sandbox'});
 }catch(error){const message=error instanceof Error?error.message:'';const auth=/required|Forbidden/.test(message);return NextResponse.json({error:auth?'Sign in with a household account.':'Account connection is not ready. Check the server setup and Plaid plan.'},{status:auth?401:503});}
}
