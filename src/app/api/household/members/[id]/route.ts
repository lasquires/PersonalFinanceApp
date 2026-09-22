import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireRole,adminDb } from '@/lib/server/auth';
const roleInput=z.object({role:z.enum(['admin','member','viewer'])});

export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){try{const{member}=await requireRole(request,['admin']);const{id}=await params;const{role}=roleInput.parse(await request.json());const{error}=await adminDb().rpc('server_set_member_role',{actor_id:member.id,member_id:id,next_role:role});if(error)throw new Error(error.message);return NextResponse.json({id,role});}catch(error){const message=error instanceof Error?error.message:'';return NextResponse.json({error:message.includes('retain an admin')?'The household must retain an administrator.':message||'Role could not be changed.'},{status:/Sign in|required/.test(message)?401:/Administrator/.test(message)?403:400});}}

export async function DELETE(request:Request,{params}:{params:Promise<{id:string}>}){try{const{member}=await requireRole(request,['admin']);const{id}=await params;const{error}=await adminDb().rpc('server_remove_member',{actor_id:member.id,member_id:id});if(error)throw new Error(error.message);return new Response(null,{status:204});}catch(error){const message=error instanceof Error?error.message:'';return NextResponse.json({error:message.includes('retain an admin')?'The household must retain an administrator.':message||'Member could not be removed.'},{status:/Sign in|required/.test(message)?401:/Administrator/.test(message)?403:400});}}
