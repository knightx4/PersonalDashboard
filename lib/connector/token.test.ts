import { describe, expect, it, vi } from 'vitest';
import { authIssuer, bearerToken, checkConnectorClaims, verifyConnectorToken } from './token';

/**
 * Which tokens the connector refuses (plan #1255), from stubbed claims. The
 * signature itself is getClaims()'s job; access.test.ts runs it for real.
 */

const ISSUER = 'https://project.supabase.co/auth/v1';
const NOW = Date.parse('2026-09-30T12:00:00.000Z');
const SECONDS = NOW / 1000;
const ME = '00000000-0000-4000-8000-00000000000a';

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sub: ME,
    iss: ISSUER,
    aud: 'authenticated',
    role: 'authenticated',
    iat: SECONDS - 600,
    exp: SECONDS + 3000,
    client_id: 'claude-client',
    ...overrides,
  };
}

function deps(revokedAt: string | null = null) {
  return { issuer: ISSUER, now: NOW, lastRevocation: vi.fn(async () => revokedAt) };
}

describe('checkConnectorClaims', () => {
  it('lets a current connector token through as its person and client', async () => {
    const d = deps();
    expect(await checkConnectorClaims(claims(), d)).toEqual({
      ok: true,
      caller: { userId: ME, clientId: 'claude-client', issuedAt: SECONDS - 600 },
    });
    expect(d.lastRevocation).toHaveBeenCalledWith(ME, 'claude-client');
  });

  it('refuses a sign-in session token, which carries no client_id', async () => {
    const d = deps();
    const verdict = await checkConnectorClaims(claims({ client_id: undefined }), d);
    expect(verdict).toMatchObject({ ok: false, reason: 'not_connector' });
    expect(d.lastRevocation).not.toHaveBeenCalled();
  });

  it('refuses an empty client_id', async () => {
    expect(await checkConnectorClaims(claims({ client_id: '' }), deps())).toMatchObject({
      reason: 'not_connector',
    });
  });

  it('refuses an expired token, and one with no expiry', async () => {
    expect(await checkConnectorClaims(claims({ exp: SECONDS - 1 }), deps())).toMatchObject({
      ok: false,
      reason: 'expired',
    });
    expect(await checkConnectorClaims(claims({ exp: SECONDS }), deps())).toMatchObject({ reason: 'expired' });
    expect(await checkConnectorClaims(claims({ exp: undefined }), deps())).toMatchObject({ reason: 'expired' });
  });

  it('refuses a token issued before the app was removed', async () => {
    const revoked = new Date(NOW - 60_000).toISOString();
    expect(await checkConnectorClaims(claims({ iat: SECONDS - 600 }), deps(revoked))).toMatchObject({
      ok: false,
      reason: 'revoked',
    });
    // The same second as the revoke is refused whichever came first.
    expect(await checkConnectorClaims(claims({ iat: SECONDS - 60 }), deps(revoked))).toMatchObject({
      reason: 'revoked',
    });
  });

  it('lets through a token issued after the app was removed and connected again', async () => {
    const revoked = new Date(NOW - 600_000).toISOString();
    expect(await checkConnectorClaims(claims({ iat: SECONDS - 30 }), deps(revoked))).toMatchObject({ ok: true });
  });

  it('refuses another issuer, another audience, no subject and no issue time', async () => {
    expect(await checkConnectorClaims(claims({ iss: 'https://other.supabase.co/auth/v1' }), deps())).toMatchObject({
      reason: 'wrong_issuer',
    });
    expect(await checkConnectorClaims(claims({ aud: 'anon' }), deps())).toMatchObject({ reason: 'wrong_audience' });
    expect(await checkConnectorClaims(claims({ aud: ['x', 'authenticated'] }), deps())).toMatchObject({ ok: true });
    expect(await checkConnectorClaims(claims({ sub: undefined }), deps())).toMatchObject({ reason: 'invalid' });
    expect(await checkConnectorClaims(claims({ iat: undefined }), deps())).toMatchObject({ reason: 'invalid' });
  });

  it('lets a failed revocation read throw rather than pass the token', async () => {
    const d = { issuer: ISSUER, now: NOW, lastRevocation: async () => Promise.reject(new Error('down')) };
    await expect(checkConnectorClaims(claims(), d)).rejects.toThrow('down');
  });
});

describe('verifyConnectorToken', () => {
  it('refuses a missing token without verifying anything', async () => {
    const getClaims = vi.fn();
    expect(await verifyConnectorToken(null, { ...deps(), getClaims })).toMatchObject({ reason: 'missing' });
    expect(getClaims).not.toHaveBeenCalled();
  });

  it('refuses a token getClaims cannot verify, naming an expired one as expired', async () => {
    const bad = async () => ({ data: null, error: new Error('Invalid JWT signature') });
    const old = async () => ({ data: null, error: new Error('JWT has expired') });
    const throws = async () => Promise.reject(new Error('Invalid JWT structure'));
    expect(await verifyConnectorToken('t', { ...deps(), getClaims: bad })).toMatchObject({ reason: 'invalid' });
    expect(await verifyConnectorToken('t', { ...deps(), getClaims: old })).toMatchObject({ reason: 'expired' });
    expect(await verifyConnectorToken('t', { ...deps(), getClaims: throws })).toMatchObject({ reason: 'invalid' });
  });

  it('checks the claims of a verified token', async () => {
    const getClaims = async () => ({ data: { claims: claims({ client_id: undefined }) }, error: null });
    expect(await verifyConnectorToken('t', { ...deps(), getClaims })).toMatchObject({ reason: 'not_connector' });
  });
});

describe('bearerToken and authIssuer', () => {
  it('reads the token from a bearer header and nothing else', () => {
    expect(bearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(bearerToken('bearer  abc ')).toBe('abc');
    expect(bearerToken('Basic abc')).toBeNull();
    expect(bearerToken('Bearer')).toBeNull();
    expect(bearerToken(null)).toBeNull();
  });

  it('names the auth server under the project URL', () => {
    expect(authIssuer('https://project.supabase.co/')).toBe(ISSUER);
  });
});
