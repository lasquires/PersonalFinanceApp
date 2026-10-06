import test from 'node:test';
import assert from 'node:assert/strict';
import { snapDisplay } from '../src/lib/snap/display';
import type { SnapBalance, SnapPublicObservation } from '../src/lib/types';

const trusted: SnapBalance = { id: '2026-10', benefit_month: '2026-10-01', balance_cents: 20000, observed_at: '2026-10-05T10:00:00Z', source: 'muse' };
const accepted: SnapPublicObservation = { id: '2026-10:accepted', benefit_month: '2026-10-01', balance_cents: 19000, observed_at: '2026-10-05T11:00:00Z', flagged: false, received_at: '2026-10-05T11:00:01Z' };
const flagged: SnapPublicObservation = { ...accepted, id: '2026-10:flagged', balance_cents: 90000, observed_at: '2026-10-05T12:00:00Z', flagged: true };

test('newer unverified observation is shown with source and stale status', () => {
  const state = snapDisplay([trusted], [accepted], new Date('2026-10-05T12:00:00Z'));
  assert.equal(state.balance?.balance_cents, 19000);
  assert.equal(state.unverified, true);
  assert.equal(state.stale, false);
  assert.equal(snapDisplay([trusted], [accepted], new Date('2026-10-07T12:00:00Z')).stale, true);
});

test('flagged amount is withheld, and a newer protected report takes precedence', () => {
  const state = snapDisplay([trusted], [accepted, flagged], new Date('2026-10-05T12:00:00Z'));
  assert.equal(state.balance?.balance_cents, 19000);
  assert.equal(state.flagged, true);
  const laterTrusted = { ...trusted, balance_cents: 18500, observed_at: '2026-10-05T13:00:00Z' };
  const later = snapDisplay([laterTrusted], [accepted, flagged], new Date('2026-10-05T14:00:00Z'));
  assert.equal(later.balance?.balance_cents, 18500);
  assert.equal(later.unverified, false);
  assert.equal(later.flagged, false);
});

test('no observations do not imply a successful Muse check', () => {
  const state = snapDisplay([], [], new Date('2026-10-05T12:00:00Z'));
  assert.equal(state.balance, null);
  assert.equal(state.stale, true);
});
