import { z } from 'zod';

const schema = z.strictObject({
  benefit_month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  balance_cents: z.number().int().min(0).max(250000),
  observed_at: z.string().datetime({ offset: true }),
});

export type PublicSnapPayload = z.infer<typeof schema>;
export type PublicSnapResult = 'updated' | 'unchanged' | 'flagged' | 'rate_limited';

export class PublicSnapError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function easternMonth(now: Date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit' }).formatToParts(now);
  const year = Number(parts.find(part => part.type === 'year')?.value);
  const month = Number(parts.find(part => part.type === 'month')?.value);
  return { current: `${year}-${String(month).padStart(2, '0')}`, previous: new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7) };
}

export async function parsePublicSnapRequest(request: Request, now = new Date()): Promise<PublicSnapPayload> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) {
    throw new PublicSnapError(415, 'Expected JSON.');
  }
  if (Number(request.headers.get('content-length') ?? 0) > 4096) throw new PublicSnapError(413, 'Request is too large.');
  const reader = request.body?.getReader();
  if (!reader) throw new PublicSnapError(400, 'Expected JSON.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 4096) {
      await reader.cancel();
      throw new PublicSnapError(413, 'Request is too large.');
    }
    chunks.push(value);
  }
  let input: unknown;
  try {
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch { throw new PublicSnapError(400, 'Expected valid JSON.'); }
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new PublicSnapError(422, 'Check benefit_month, balance_cents, and observed_at.');
  const months = easternMonth(now);
  if (parsed.data.benefit_month !== months.current && parsed.data.benefit_month !== months.previous) {
    throw new PublicSnapError(422, 'Benefit month must be current or previous month.');
  }
  if (Math.abs(Date.parse(parsed.data.observed_at) - now.getTime()) > 10 * 60_000) {
    throw new PublicSnapError(422, 'Observation must be within 10 minutes of server time.');
  }
  return parsed.data;
}

export function publicSnapResponse(result: PublicSnapResult): Response {
  const headers = { 'Cache-Control': 'no-store' };
  if (result === 'rate_limited') return Response.json({ ok: false, error: 'Too many submissions.' }, { status: 429, headers });
  return Response.json({ ok: true }, { headers });
}
