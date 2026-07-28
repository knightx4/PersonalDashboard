import { describe, expect, it } from 'vitest';
import { signGmailOAuthState, verifyGmailOAuthState } from './oauth-state';

const SECRET = Buffer.alloc(32, 9).toString('base64');

describe('Gmail OAuth state', () => {
  it('accepts a freshly signed state', () => {
    const userId = '00000000-0000-4000-8000-000000000001';
    const state = signGmailOAuthState(userId, SECRET);
    expect(verifyGmailOAuthState(state, userId, SECRET)).toBe(true);
  });

  it('rejects another user', () => {
    const state = signGmailOAuthState('00000000-0000-4000-8000-000000000001', SECRET);
    expect(verifyGmailOAuthState(state, '00000000-0000-4000-8000-000000000002', SECRET)).toBe(
      false,
    );
  });
});
