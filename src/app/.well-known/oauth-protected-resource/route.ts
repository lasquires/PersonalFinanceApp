import { protectedResourceMetadata } from '@/lib/server/oauth';
export function GET(){const appUrl=process.env.APP_URL??'https://squires-family-finance.vercel.app';const supabaseUrl=process.env.NEXT_PUBLIC_SUPABASE_URL??'https://tcrbcqrsafuckhsknfoy.supabase.co';return Response.json(protectedResourceMetadata(appUrl,supabaseUrl),{headers:{'Cache-Control':'public, max-age=3600'}});}
