import { NextResponse } from 'next/server';
import { createHash, timingSafeEqual } from 'node:crypto';
import { decodeProtectedHeader, importJWK, jwtVerify } from 'jose';
import { items,plaid,syncItem } from '@/lib/server/plaid';
import { adminDb } from '@/lib/server/auth';
export const maxDuration=60;
export async function POST(request:Request) {
 const raw=await request.text();if(raw.length>100000)return new Response(null,{status:413});
 try{const token=request.headers.get('plaid-verification');if(!token)throw new Error();const head=decodeProtectedHeader(token);if(head.alg!=='ES256'||!head.kid)throw new Error();const {data}=await plaid().webhookVerificationKeyGet({key_id:head.kid});if(data.key.expired_at)throw new Error();const key=await importJWK({...data.key},'ES256');const {payload}=await jwtVerify(token,key,{algorithms:['ES256'],maxTokenAge:'5 min'});if(typeof payload.request_body_sha256!=='string'||!/^[a-f0-9]{64}$/.test(payload.request_body_sha256))throw new Error();const actual=createHash('sha256').update(raw).digest();const claimed=Buffer.from(payload.request_body_sha256,'hex');if(!timingSafeEqual(actual,claimed))throw new Error();}catch{return new Response(null,{status:401});}
 try{const body=JSON.parse(raw);const item=(await items()).find(i=>i.id===body.item_id);if(!item)return NextResponse.json({ok:true});if(body.webhook_type==='TRANSACTIONS'&&body.webhook_code==='SYNC_UPDATES_AVAILABLE')await syncItem(item);if(body.webhook_type==='ITEM'&&body.webhook_code==='ERROR'){const code=typeof body.error?.error_code==='string'&&/^[A-Z_]+$/.test(body.error.error_code)?body.error.error_code:'ITEM_ERROR';await adminDb().rpc('server_sync_error',{item:item.id,code});}return NextResponse.json({ok:true});}catch{return new Response(null,{status:503});}
}
