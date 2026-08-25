import { describe, expect, it, vi } from 'vitest';
import { getJson, ProviderError } from '@/lib/books/providers/http';

const noRetry = { provider: 'test', retryDelaysMs: [] };

describe('getJson', () => {
  it('returns parsed JSON on success', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    await expect(getJson('https://x.test', { ...noRetry, fetch: fetchFn })).resolves.toEqual({
      ok: 1,
    });
  });

  it('treats 404 as a genuine miss, not a failure', async () => {
    const fetchFn = vi.fn(async () => new Response('nope', { status: 404 }));
    await expect(getJson('https://x.test', { ...noRetry, fetch: fetchFn })).resolves.toBeNull();
  });

  it('reports a quota error as rate_limited rather than an empty result', async () => {
    const fetchFn = vi.fn(async () => new Response('quota', { status: 429 }));
    await expect(
      getJson('https://x.test', { ...noRetry, fetch: fetchFn }),
    ).rejects.toMatchObject({ failure: { kind: 'rate_limited', status: 429 } });
  });

  it('retries a 503 and succeeds on the second attempt', async () => {
    let calls = 0;
    const fetchFn = vi.fn(async () => {
      calls += 1;
      return calls === 1
        ? new Response('busy', { status: 503 })
        : new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    await expect(
      getJson('https://x.test', { provider: 'test', fetch: fetchFn, retryDelaysMs: [0] }),
    ).resolves.toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it('does not retry a rejected key', async () => {
    const fetchFn = vi.fn(async () => new Response('bad key', { status: 401 }));
    await expect(
      getJson('https://x.test', { provider: 'test', fetch: fetchFn, retryDelaysMs: [0, 0] }),
    ).rejects.toBeInstanceOf(ProviderError);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
