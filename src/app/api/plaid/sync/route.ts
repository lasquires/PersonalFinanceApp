import { NextResponse } from 'next/server';
import { requireMember } from '@/lib/server/auth';
import { items,syncItem } from '@/lib/server/plaid';
export const maxDuration=60;
export async function POST(request:Request) {try{await requireMember(request);const body=await request.json();const item=(await items()).find(i=>i.id===body.item_id);if(!item)return NextResponse.json({error:'Connection not found'},{status:404});await syncItem(item);return NextResponse.json({ok:true});}catch{return NextResponse.json({error:'Sync could not finish. Retry shortly, or reconnect if the account needs attention.'},{status:503});}}
