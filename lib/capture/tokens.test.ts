import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { SchemaClient } from '@/lib/ask/db';
import {
  CAPTURE_TOKEN_RATE,
  captureTokenLabel,
  captureTokenVerdict,
  checkCaptureToken,
  hashCaptureToken,
  isCaptureTokenShape,
  makeCaptureToken,
  tokenFromAuthorization,
} from './tokens';

/** Personal capture tokens (plan #1705). The database side is tests/capture-tokens.test.ts. */

const NOW = Date.parse('2026-10-09T12:00:00Z');

function rpcStub(result: { data: unknown; error: { message: string } | null }) {
  const rpc = vi.fn(async () => result);
  return { client: { rpc } as unknown as SchemaClient, rpc };
}

describe('making and hashing a token', () => {
  it('makes a token of the expected shape whose hash is its hex SHA-256', () => {
    const { token, hash } = makeCaptureToken();
    expect(isCaptureTokenShape(token)).toBe(true);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(hash).not.toContain(token.slice(5));
  });

  it('never makes the same token twice, and hashes the same token the same way', () => {
    const a = makeCaptureToken();
    const b = makeCaptureToken();
    expect(a.token).not.toBe(b.token);
    expect(hashCaptureToken(a.token)).toBe(a.hash);
  });

  it('reads a bearer token from the header and nothing else', () => {
    expect(tokenFromAuthorization('Bearer dash_abc')).toBe('dash_abc');
    expect(tokenFromAuthorization('bearer  dash_abc ')).toBe('dash_abc');
    expect(tokenFromAuthorization('Basic xyz')).toBeNull();
    expect(tokenFromAuthorization(null)).toBeNull();
  });

  it('tidies a label and refuses a blank one', () => {
    expect(captureTokenLabel('  iPhone   Shortcut ')).toBe('iPhone Shortcut');
    expect(captureTokenLabel('   ')).toBeNull();
    expect(captureTokenLabel('x'.repeat(80))).toHaveLength(60);
  });
});

describe('checking a presented token', () => {
  it('refuses a missing or malformed token without asking the database', async () => {
    const { client, rpc } = rpcStub({ data: [], error: null });
    expect(await checkCaptureToken(client, null, NOW)).toMatchObject({ ok: false, status: 401, reason: 'missing' });
    expect(await checkCaptureToken(client, 'dash_short', NOW)).toMatchObject({ ok: false, status: 401, reason: 'malformed' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('sends the hash, never the token, with the limits', async () => {
    const { token, hash } = makeCaptureToken();
    const { client, rpc } = rpcStub({
      data: [{ outcome: 'ok', user_id: 'u1', token_id: 't1', retry_at: null }],
      error: null,
    });
    expect(await checkCaptureToken(client, token, NOW)).toEqual({ ok: true, userId: 'u1', tokenId: 't1' });
    expect(rpc).toHaveBeenCalledWith('use_capture_token', {
      p_hash: hash,
      p_per_minute: CAPTURE_TOKEN_RATE.perMinute,
      p_per_day: CAPTURE_TOKEN_RATE.perDay,
      p_now: new Date(NOW).toISOString(),
    });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain(token);
  });

  it('refuses a revoked token', async () => {
    const { client } = rpcStub({
      data: [{ outcome: 'revoked', user_id: null, token_id: null, retry_at: null }],
      error: null,
    });
    expect(await checkCaptureToken(client, makeCaptureToken().token, NOW)).toMatchObject({
      ok: false,
      status: 401,
      reason: 'revoked',
    });
  });

  it('throws when the database cannot be asked, rather than letting the capture through', async () => {
    const { client } = rpcStub({ data: null, error: { message: 'down' } });
    await expect(checkCaptureToken(client, makeCaptureToken().token, NOW)).rejects.toThrow(/down/);
  });
});

describe('the verdict on a burst', () => {
  it('refuses with a 429 and says when to come back', () => {
    const verdict = captureTokenVerdict(
      { outcome: 'limited', user_id: 'u1', token_id: 't1', retry_at: new Date(NOW + 42_000).toISOString() },
      NOW,
    );
    expect(verdict).toMatchObject({ ok: false, status: 429, reason: 'limited', retryAfterSeconds: 42 });
    if (!verdict.ok) expect(verdict.message).toContain('Try again in 42 seconds');
  });

  it('rounds a day-long wait to hours', () => {
    const verdict = captureTokenVerdict(
      { outcome: 'limited', user_id: 'u1', token_id: 't1', retry_at: new Date(NOW + 5 * 3_600_000 - 1).toISOString() },
      NOW,
    );
    if (verdict.ok) throw new Error('expected a refusal');
    expect(verdict.message).toContain('Try again in 5 hours');
  });

  it('treats no row as an unknown token', () => {
    expect(captureTokenVerdict(null, NOW)).toMatchObject({ ok: false, status: 401, reason: 'unknown' });
  });
});
