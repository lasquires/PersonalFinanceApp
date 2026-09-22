import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/server/auth';
import { createInvitation, productionInvitationDependencies } from '@/lib/server/household-admin';

export async function POST(request:Request){
  try{const{member}=await requireRole(request,['admin']);const result=await createInvitation(await request.json(),await productionInvitationDependencies({id:member.id,role:'admin'}));return NextResponse.json(result,{status:201});}
  catch(error){const message=error instanceof Error?error.message:'';const status=/Sign in|required/.test(message)?401:/Administrator/.test(message)?403:/already/.test(message)?409:/could not be sent/.test(message)?503:400;return NextResponse.json({error:status===400?'Check the email address and access level.':message},{status});}
}
