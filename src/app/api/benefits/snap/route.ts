import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { adminDb } from '@/lib/server/auth';

const payloadSchema = z.strictObject({
  benefit_month: z.string().regex(/^\d{4}-\d{2}$/),
  balance_cents: z.number().int().min(0).max(100_000_000),
  observed_at: z.string().datetime({ offset: true }),
});

export async function POST(request: Request) {
  const authorization = request.headers.get('authorization') ?? '';
  const match = /^Bearer (snap_[A-Za-z0-9_-]{43})$/.exec(authorization);
  if (!match) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const db = adminDb();
    const tokenHash = createHash('sha256').update(match[1]).digest('hex');
    const { data: token, error: tokenError } = await db.from('snap_api_tokens').select('id').eq('token_hash', tokenHash).is('revoked_at', null).maybeSingle();
    if (tokenError) throw tokenError;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) {
      return NextResponse.json({ error: 'Expected JSON' }, { status: 415 });
    }
    const declaredSize = Number(request.headers.get('content-length') ?? 0);
    if (declaredSize > 4096) return NextResponse.json({ error: 'Request is too large.' }, { status: 413 });
    let body: unknown;
    try { body = await request.json(); }
    catch { return NextResponse.json({ error: 'Expected valid JSON.' }, { status: 400 }); }
    const parsed = payloadSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'Check benefit_month, balance_cents, and observed_at.' }, { status: 400 });

    const { benefit_month, balance_cents, observed_at } = parsed.data;
    const monthStart = new Date(`${benefit_month}-01T00:00:00.000Z`);
    if (monthStart.toISOString().slice(0, 7) !== benefit_month) {
      return NextResponse.json({ error: 'Invalid benefit month.' }, { status: 400 });
    }
    const now = Date.now();
    const observedAtMs = Date.parse(observed_at);
    if (observedAtMs > now + 5 * 60_000 || observedAtMs < now - 72 * 60 * 60_000) {
      return NextResponse.json({ error: 'The observation time must be within the last 72 hours.' }, { status: 400 });
    }

    const { data: updated, error } = await db.rpc('server_save_snap_balance', {
      month_start: `${benefit_month}-01`,
      amount: balance_cents,
      seen_at: observed_at,
    });
    if (error) throw error;
    return NextResponse.json({ ok: true, updated: Boolean(updated) });
  } catch {
    return NextResponse.json({ error: 'SNAP update could not be saved.' }, { status: 503 });
  }
}
