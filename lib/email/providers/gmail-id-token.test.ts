import { describe, expect, it } from 'vitest';
import { emailFromIdToken } from '../id-token';

describe('emailFromIdToken', () => {
  it('reads the email claim', () => {
    const payload = Buffer.from(
      JSON.stringify({ email: 'you@gmail.com', email_verified: true }),
    ).toString('base64url');
    const token = `hdr.${payload}.sig`;
    expect(emailFromIdToken(token)).toBe('you@gmail.com');
  });

  it('returns null for garbage', () => {
    expect(emailFromIdToken('not-a-jwt')).toBeNull();
  });
});
