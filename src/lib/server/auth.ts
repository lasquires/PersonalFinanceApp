import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { serverDb } from '../supabase/server';
export type MemberRole = 'admin'|'member'|'viewer';
export async function requireMember(request?: Request) {
  if (request && request.method !== 'GET') { const origin = request.headers.get('origin'); if (origin && origin !== new URL(request.url).origin && origin !== process.env.APP_URL) throw new Error('Forbidden origin'); }
  const db = await serverDb(); const { data, error } = await db.auth.getUser();
  if (error || !data.user) throw new Error('Sign in required');
  const member = await db.from('members').select('id,name,email,role').eq('id', data.user.id).single();
  if (member.error || !member.data) throw new Error('Household access required');
  return { db, user: data.user, member: member.data };
}
export async function requireRole(request:Request,roles:MemberRole[]){const context=await requireMember(request);if(!roles.includes(context.member.role as MemberRole))throw new Error('Administrator access required');return context;}
export function adminDb() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Server database key is not configured');
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
