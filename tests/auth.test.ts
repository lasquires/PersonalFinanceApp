import test from 'node:test';
import assert from 'node:assert/strict';
import { googleSignInOptions } from '../src/lib/auth';

test('Google sign-in returns to the app after authentication', () => {
  assert.deepEqual(googleSignInOptions('https://squires-family-finance.vercel.app'), {
    provider: 'google',
    options: { redirectTo: 'https://squires-family-finance.vercel.app' },
  });
});
