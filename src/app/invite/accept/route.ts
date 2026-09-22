import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { serverDb } from '@/lib/supabase/server';
import { adminDb } from '@/lib/server/auth';

export async function GET(request:Request){const url=new URL(request.url);const token=url.searchParams.get('token');const code=url.searchParams.get('code');const db=await serverDb();if(code)await db.auth.exchangeCodeForSession(code);const{data}=await db.auth.getUser();if(!token||!data.user?.email)return NextResponse.redirect(new URL('/?invite=signin',url));const tokenHash=createHash('sha256').update(token).digest('hex');const{data:accepted,error}=await adminDb().rpc('server_accept_invitation',{user_id:data.user.id,supplied_email:data.user.email,supplied_hash:tokenHash});if(error||!accepted)return NextResponse.redirect(new URL('/?invite=invalid',url));return NextResponse.redirect(new URL('/',url));}
