import { NextResponse } from 'next/server';
import { z } from 'zod';
import { adminDb, requireMember } from '@/lib/server/auth';
import { items, plaid, syncItem } from '@/lib/server/plaid';
export const maxDuration=60;
const schema=z.object({public_token:z.string().min(1).max(1000),institution:z.string().max(200).default('Connected institution')});
export async function POST(request:Request) {
 try{const {member}=await requireMember(request);const body=schema.parse(await request.json());const all=await items();if(all.length>=Number(process.env.PLAID_MAX_ITEMS??5))return NextResponse.json({error:'Connection limit reached.'},{status:409});const client=plaid();const {data:exchange}=await client.itemPublicTokenExchange({public_token:body.public_token});
 try{const {data}=await client.accountsGet({access_token:exchange.access_token});const result=await adminDb().rpc('server_save_item',{item:exchange.item_id,token:exchange.access_token,institution_name:body.institution,member_name:member.name,account_rows:data.accounts});if(result.error)throw new Error('SAVE_FAILED');}catch{await client.itemRemove({access_token:exchange.access_token}).catch(()=>{});throw new Error('SAVE_FAILED');}
 try{await syncItem({id:exchange.item_id,access_token:exchange.access_token,cursor:'',institution:body.institution,member:member.name,sync_error:null});return NextResponse.json({ok:true});}catch{return NextResponse.json({ok:true,notice:'Account connected. Initial sync needs a retry in Settings.'});}
 }catch{return NextResponse.json({error:'Could not connect this account. Please sign in and try again.'},{status:400});}
}
