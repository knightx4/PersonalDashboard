import { describe, expect, it } from 'vitest';
import { decryptToken, encryptToken } from './tokens';

const KEY = Buffer.alloc(32, 7).toString('base64');

describe('encryptToken / decryptToken', () => {
  it('round-trips refresh tokens', () => {
    const plain = '1//0g_refresh_token_example';
    const enc = encryptToken(plain, KEY);
    expect(enc.startsWith('v1:')).toBe(true);
    expect(decryptToken(enc, KEY)).toBe(plain);
  });

  it('rejects wrong keys', () => {
    const enc = encryptToken('secret', KEY);
    const other = Buffer.alloc(32, 3).toString('base64');
    expect(() => decryptToken(enc, other)).toThrow();
  });
});
