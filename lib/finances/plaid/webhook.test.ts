import { createHash, generateKeyPairSync, sign } from 'crypto';
import { describe, expect, it } from 'vitest';
import { linkPatchFor, parseWebhook, tokenKeyId, verifyPlaidWebhook, type VerificationKey } from './webhook';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwk = publicKey.export({ format: 'jwk' }) as { kty: string; crv: string; x: string; y: string };
const KEY: VerificationKey = { alg: 'ES256', kid: 'kid-1', expired_at: null, ...jwk };

const NOW = new Date('2026-10-28T12:00:00Z');
const BODY = JSON.stringify({ webhook_type: 'TRANSACTIONS', webhook_code: 'SYNC_UPDATES_AVAILABLE', item_id: 'item-1' });

function b64(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function token(body: string, over: { iat?: number; kid?: string } = {}): string {
  const header = b64({ alg: 'ES256', kid: over.kid ?? 'kid-1', typ: 'JWT' });
  const payload = b64({
    iat: over.iat ?? Math.floor(NOW.getTime() / 1000) - 10,
    request_body_sha256: createHash('sha256').update(body).digest('hex'),
  });
  const signature = sign('sha256', Buffer.from(`${header}.${payload}`), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return `${header}.${payload}.${signature.toString('base64url')}`;
}

describe('verifyPlaidWebhook', () => {
  it('accepts a webhook Plaid signed, sent just now, with the body it hashed', () => {
    const t = token(BODY);
    expect(tokenKeyId(t)).toBe('kid-1');
    expect(verifyPlaidWebhook({ token: t, body: BODY, key: KEY, now: NOW })).toEqual({ ok: true });
  });

  it('refuses a body changed after signing', () => {
    expect(verifyPlaidWebhook({ token: token(BODY), body: BODY.replace('item-1', 'item-2'), key: KEY, now: NOW }))
      .toEqual({ ok: false, reason: 'body does not match' });
  });

  it('refuses one older than five minutes', () => {
    const t = token(BODY, { iat: Math.floor(NOW.getTime() / 1000) - 301 });
    expect(verifyPlaidWebhook({ token: t, body: BODY, key: KEY, now: NOW })).toEqual({ ok: false, reason: 'too old' });
  });

  it('refuses a signature from another key, and no header at all', () => {
    const other = generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({ format: 'jwk' }) as typeof jwk;
    expect(verifyPlaidWebhook({ token: token(BODY), body: BODY, key: { ...KEY, ...other }, now: NOW }).ok).toBe(false);
    expect(verifyPlaidWebhook({ token: null, body: BODY, key: KEY, now: NOW }).ok).toBe(false);
    expect(verifyPlaidWebhook({ token: token(BODY), body: BODY, key: { ...KEY, expired_at: 1 }, now: NOW }).ok).toBe(false);
  });
});

describe('linkPatchFor', () => {
  it('marks a link needing attention when Plaid says the login must be repeated, and clears it on repair', () => {
    const error = parseWebhook(
      JSON.stringify({
        webhook_type: 'ITEM',
        webhook_code: 'ERROR',
        item_id: 'item-1',
        error: { error_code: 'ITEM_LOGIN_REQUIRED', error_message: 'the login details of this item have changed' },
      }),
    )!;
    expect(linkPatchFor(error)).toEqual({
      needs_update: true,
      status: 'error',
      last_error: 'the login details of this item have changed',
    });
    expect(linkPatchFor({ webhook_type: 'ITEM', webhook_code: 'LOGIN_REPAIRED', item_id: 'item-1' })).toEqual({
      needs_update: false,
      status: 'active',
      last_error: null,
    });
    expect(linkPatchFor(parseWebhook(BODY)!)).toBeNull();
  });
});
