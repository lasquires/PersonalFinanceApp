import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePublicSnapRequest, PublicSnapError, publicSnapResponse } from '../src/lib/snap/public-intake';

const now = new Date('2026-10-05T20:00:00Z');
const body = { benefit_month: '2026-10', balance_cents: 19758, observed_at: '2026-10-05T19:59:00Z' };
const request = (value: unknown, contentType = 'application/json') => new Request('https://app.test/api/benefits/snap-observation', { method: 'POST', headers: { 'content-type': contentType }, body: typeof value === 'string' ? value : JSON.stringify(value) });

test('public SNAP parser accepts a recent observation and previous Eastern month', async () => {
  assert.deepEqual(await parsePublicSnapRequest(request(body), now), body);
  assert.equal((await parsePublicSnapRequest(request({ ...body, benefit_month: '2026-09' }), now)).benefit_month, '2026-09');
});

test('public SNAP parser rejects invalid amounts, months, timestamps, unknown fields and large bodies', async () => {
  for (const invalid of [
    { ...body, balance_cents: 250001 }, { ...body, balance_cents: 1.5 },
    { ...body, benefit_month: '2026-11' }, { ...body, benefit_month: '2026-08' },
    { ...body, benefit_month: '2026-13' }, { ...body, observed_at: '2026-10-05T19:49:00Z' },
    { ...body, observed_at: '2026-10-05T20:11:00Z' }, { ...body, extra: 'x' },
  ]) {
    await assert.rejects(parsePublicSnapRequest(request(invalid), now), (error: PublicSnapError) => error.status === 422);
  }
  await assert.rejects(parsePublicSnapRequest(request(body, 'text/plain'), now), (error: PublicSnapError) => error.status === 415);
  await assert.rejects(parsePublicSnapRequest(request('x'.repeat(4097)), now), (error: PublicSnapError) => error.status === 413);
  await assert.rejects(parsePublicSnapRequest(request('{broken'), now), (error: PublicSnapError) => error.status === 400);
});

test('public SNAP response never returns balance data', async () => {
  const success = publicSnapResponse('updated');
  assert.deepEqual(await success.json(), { ok: true });
  assert.equal(success.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await publicSnapResponse('flagged').json(), { ok: true });
  assert.deepEqual(await publicSnapResponse('unchanged').json(), { ok: true });
  assert.equal(publicSnapResponse('rate_limited').status, 429);
});
