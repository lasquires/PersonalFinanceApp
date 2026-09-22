import { z } from 'zod';
import { createHash, randomBytes } from 'node:crypto';

export const normalizeEmail = (value: string) => value.trim().toLowerCase();

export const invitationInput = z.object({
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(['admin', 'member', 'viewer']).default('viewer'),
});

type Role = 'admin'|'member'|'viewer';
type PendingInput = { email:string;role:Role;token_hash:string;invited_by:string;expires_at:string };
type Pending = PendingInput & { id:string };

export type InvitationDependencies = {
  actor:{id:string;role:Role};
  appUrl:string;
  existingMember:(email:string)=>Promise<boolean>;
  existingPending:(email:string)=>Promise<Pending|null>;
  savePending:(input:PendingInput)=>Promise<Pending>;
  markError:(id:string)=>Promise<void>;
  sendInvite:(email:string,redirectTo:string)=>Promise<void>;
};

export function invitationToken(){const token=randomBytes(32).toString('base64url');return{token,token_hash:createHash('sha256').update(token).digest('hex')};}

export async function createInvitation(raw:z.input<typeof invitationInput>,deps:InvitationDependencies) {
  if(deps.actor.role!=='admin')throw new Error('Administrator access required');
  const input=invitationInput.parse(raw);const email=normalizeEmail(input.email);
  if(await deps.existingMember(email))throw new Error('This person is already a household member');
  if(await deps.existingPending(email))throw new Error('An invitation is already pending');
  const{token,token_hash}=invitationToken();
  const pending=await deps.savePending({email,role:input.role,token_hash,invited_by:deps.actor.id,expires_at:new Date(Date.now()+7*86400000).toISOString()});
  try{await deps.sendInvite(email,`${deps.appUrl}/invite/accept?token=${encodeURIComponent(token)}`);}catch{await deps.markError(pending.id);throw new Error('Invitation email could not be sent');}
  return {id:pending.id,status:'pending' as const};
}

export async function productionInvitationDependencies(actor:{id:string;role:Role}){
  const {adminDb}=await import('./auth');const db=adminDb();const appUrl=process.env.APP_URL;if(!appUrl)throw new Error('Application URL is not configured');
  return {actor,appUrl,
    existingMember:async(email:string)=>{const{data,error}=await db.from('members').select('id').ilike('email',email).maybeSingle();if(error)throw error;return Boolean(data);},
    existingPending:async(email:string)=>{const{data,error}=await db.from('household_invitations').select('*').eq('email',email).eq('status','pending').maybeSingle();if(error)throw error;return data as Pending|null;},
    savePending:async(input:PendingInput)=>{const{data,error}=await db.from('household_invitations').insert(input).select('*').single();if(error)throw error;return data as Pending;},
    markError:async(id:string)=>{const{error}=await db.from('household_invitations').update({status:'error',updated_at:new Date().toISOString()}).eq('id',id);if(error)throw error;},
    sendInvite:async(email:string,redirectTo:string)=>{const{error}=await db.auth.admin.inviteUserByEmail(email,{redirectTo});if(error)throw error;},
  } satisfies InvitationDependencies;
}
