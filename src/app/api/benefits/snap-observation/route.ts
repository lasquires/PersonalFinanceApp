import { createHash } from 'node:crypto';
import { adminDb } from '@/lib/server/auth';
import { parsePublicSnapRequest, PublicSnapError, publicSnapResponse, type PublicSnapResult } from '@/lib/snap/public-intake';

export async function POST(request: Request) {
  try {
    const payload = await parsePublicSnapRequest(request);
    const ip = (request.headers.get('x-vercel-forwarded-for') ?? request.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim();
    const clientHash = createHash('sha256').update(ip).digest('hex');
    const { data, error } = await adminDb().rpc('server_receive_public_snap', {
      month_start: `${payload.benefit_month}-01`, amount: payload.balance_cents,
      seen_at: payload.observed_at, client_hash: clientHash,
    });
    if (error || !['updated', 'unchanged', 'flagged', 'rate_limited'].includes(data)) throw error ?? new Error('Unexpected SNAP intake result');
    return publicSnapResponse(data as PublicSnapResult);
  } catch (error) {
    if (error instanceof PublicSnapError) return Response.json({ ok: false, error: error.message }, { status: error.status, headers: { 'Cache-Control': 'no-store' } });
    return Response.json({ ok: false, error: 'SNAP report could not be saved.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
