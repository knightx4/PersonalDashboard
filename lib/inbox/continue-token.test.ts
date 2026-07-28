import { describe, expect, it } from 'vitest';
import {
  signInboxContinueToken,
  verifyInboxContinueToken,
} from '@/lib/inbox/continue-token';

describe('inbox continue token', () => {
  const secret = 'test-secret';
  const payload = { userId: 'u1', accountId: 'a1', jobId: 'j1' };

  it('round-trips a signed token', () => {
    const token = signInboxContinueToken(secret, payload);
    expect(verifyInboxContinueToken(secret, payload, token)).toBe(true);
    expect(
      verifyInboxContinueToken(secret, { ...payload, jobId: 'other' }, token),
    ).toBe(false);
  });
});
