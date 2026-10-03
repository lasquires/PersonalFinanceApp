import { createHash, randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requireRole, adminDb } from '@/lib/server/auth';

export async function POST(request: Request) {
  try {
    await requireRole(request, ['admin']);
    const token = `snap_${randomBytes(32).toString('base64url')}`;
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const { error } = await adminDb().rpc('server_rotate_snap_api_token', { next_hash: tokenHash });
    if (error) throw error;
    return NextResponse.json({ token }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const status = /Sign in|required/.test(message) ? 401 : /Administrator/.test(message) ? 403 : 503;
    return NextResponse.json({ error: status === 503 ? 'The Muse key could not be created. Apply the SNAP integration database update first.' : message }, { status });
  }
}
