import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { batchTexts, embedOne, embedTexts } from './embed';
import { EMBEDDING_DIMENSIONS, type EmbeddingClient, type EmbeddingResult } from './voyage';

/**
 * Batching, backing off, and what a failure leaves behind.
 *
 * The client is handed in, the way lib/learn/locate's tests hand in an
 * Anthropic client, so no test here has a key or a network. The two cases that
 * matter are the ones the step was written around: many segments going out as
 * several requests and coming back in order, and a batch failing halfway
 * through a run without leaving the caller half a list it cannot align.
 */

function vector(seed: number): number[] {
  return new Array(EMBEDDING_DIMENSIONS).fill(seed);
}

/** A client that answers every batch, numbering the vectors as it goes. */
function answering(options: { model?: string; tokensPerBatch?: number } = {}): EmbeddingClient {
  let next = 0;
  return vi.fn(async ({ texts }) => ({
    ok: true as const,
    vectors: texts.map(() => vector(next++)),
    model: options.model ?? 'voyage-4-lite',
    tokens: options.tokensPerBatch ?? 10,
  }));
}

/** A client that answers from a script, one entry per call. */
function scripted(...results: EmbeddingResult[]): EmbeddingClient {
  let call = 0;
  return vi.fn(async () => results[Math.min(call++, results.length - 1)]);
}

const rateLimited = (retryAfterMs: number | null = null): EmbeddingResult => ({
  ok: false,
  reason: 'rate-limited',
  detail: 'slow down',
  tokens: 0,
  retryAfterMs,
});

const ok = (count: number, tokens = 10): EmbeddingResult => ({
  ok: true,
  vectors: Array.from({ length: count }, (_, i) => vector(i)),
  model: 'voyage-4-lite',
  tokens,
});

const never = async () => {
  throw new Error('a test waited for real');
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('batching', () => {
  it('splits on the count ceiling', () => {
    const batches = batchTexts(new Array(300).fill('x'));
    expect(batches.map((b) => b.length)).toEqual([128, 128, 44]);
  });

  it('splits on the size ceiling before the count ceiling', () => {
    const batches = batchTexts(new Array(10).fill('x'.repeat(100)), { maxChars: 250 });
    expect(batches.map((b) => b.length)).toEqual([2, 2, 2, 2, 2]);
  });

  it('sends a text bigger than the ceiling on its own rather than dropping it', () => {
    const batches = batchTexts(['short', 'x'.repeat(1000), 'short'], { maxChars: 100 });
    expect(batches.map((b) => b.length)).toEqual([1, 1, 1]);
  });

  it('has nothing to send for an empty list', () => {
    expect(batchTexts([])).toEqual([]);
  });
});

describe('embedding a list', () => {
  it('returns one vector per text, in order, across several requests', async () => {
    const client = answering();
    const texts = Array.from({ length: 300 }, (_, i) => `segment ${i}`);

    const outcome = await embedTexts({ texts, client });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.vectors).toHaveLength(300);
    expect(vi.mocked(client)).toHaveBeenCalledTimes(3);
    // The vectors were numbered in the order they were produced, so this is
    // the check that batch two did not land in front of batch one.
    expect(outcome.vectors[0][0]).toBe(0);
    expect(outcome.vectors[299][0]).toBe(299);
  });

  it('embeds documents unless asked for a query', async () => {
    const client = answering();

    await embedTexts({ texts: ['a'], client });
    await embedTexts({ texts: ['a claim'], client, inputType: 'query' });

    expect(vi.mocked(client).mock.calls[0][0].inputType).toBe('document');
    expect(vi.mocked(client).mock.calls[1][0].inputType).toBe('query');
  });

  it('makes no call at all for an empty list', async () => {
    const client = answering();

    const outcome = await embedTexts({ texts: [], client });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.vectors).toEqual([]);
    expect(vi.mocked(client)).not.toHaveBeenCalled();
  });

  it('refuses an empty text here rather than at the provider', async () => {
    const client = answering();

    const outcome = await embedTexts({ texts: ['a', '   '], client });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('empty-text');
    expect(vi.mocked(client)).not.toHaveBeenCalled();
  });

  it('says so when there is no key, instead of failing somewhere harder to read', async () => {
    vi.stubEnv('EMBEDDING_API_KEY', '');

    const outcome = await embedTexts({ texts: ['a'] });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('no-key');
    expect(outcome.detail).toContain('EMBEDDING_API_KEY');
  });

  it('hands back one vector for one text', async () => {
    const outcome = await embedOne('a claim', { client: answering(), inputType: 'query' });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.vector).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(outcome.model).toBe('voyage-4-lite');
  });
});

describe('when a batch fails halfway', () => {
  it('returns no vectors at all rather than the ones that worked', async () => {
    const texts = Array.from({ length: 200 }, (_, i) => `segment ${i}`);
    const client = scripted(ok(128, 40), {
      ok: false,
      reason: 'malformed',
      detail: 'asked for 72 vectors, got 70',
      tokens: 25,
      retryAfterMs: null,
    });

    const outcome = await embedTexts({ texts, client });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('malformed');
    expect('vectors' in outcome).toBe(false);
    // Both calls are still on the bill, including the one that came back
    // unusable.
    expect(outcome.tokens).toBe(65);
  });

  it('does not ask again about a key that was refused', async () => {
    const client = scripted({
      ok: false,
      reason: 'refused',
      detail: '401: the key was not accepted',
      tokens: 0,
      retryAfterMs: null,
    });

    const outcome = await embedTexts({ texts: ['a'], client, sleep: never });

    expect(outcome.ok).toBe(false);
    expect(vi.mocked(client)).toHaveBeenCalledTimes(1);
  });
});

describe('when the provider asks us to slow down', () => {
  it('waits and asks again rather than losing the batch', async () => {
    const client = scripted(rateLimited(), rateLimited(), ok(1));
    const slept: number[] = [];

    const outcome = await embedTexts({
      texts: ['a'],
      client,
      sleep: async (ms) => {
        slept.push(ms);
      },
    });

    expect(outcome.ok).toBe(true);
    expect(vi.mocked(client)).toHaveBeenCalledTimes(3);
    expect(slept).toEqual([1000, 2000]);
  });

  it('waits as long as it was told to, when it was told', async () => {
    const client = scripted(rateLimited(7_500), ok(1));
    const slept: number[] = [];

    await embedTexts({
      texts: ['a'],
      client,
      sleep: async (ms) => {
        slept.push(ms);
      },
    });

    expect(slept).toEqual([7_500]);
  });

  it('gives up after four attempts and says why', async () => {
    const client = scripted(rateLimited());

    const outcome = await embedTexts({ texts: ['a'], client, sleep: async () => {} });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('rate-limited');
    expect(vi.mocked(client)).toHaveBeenCalledTimes(4);
  });
});

describe('what it costs', () => {
  it('reports every call that produced a response, with the model that produced it', async () => {
    const reports: SpendReport[] = [];
    const texts = Array.from({ length: 200 }, (_, i) => `segment ${i}`);

    const outcome = await embedTexts({
      texts,
      client: answering({ model: 'voyage-4', tokensPerBatch: 55 }),
      onSpend: (report) => reports.push(report),
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.tokens).toBe(110);
    expect(outcome.model).toBe('voyage-4');
    expect(reports).toHaveLength(2);
    expect(reports[0].model).toBe('voyage-4');
    // An embedding call has input tokens and nothing else.
    expect(reports[0].usage).toEqual({
      inputTokens: 55,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
    });
  });

  it('charges nothing for a rate limit, and everything for a response it could not read', async () => {
    const reports: SpendReport[] = [];
    const client = scripted(rateLimited(), {
      ok: false,
      reason: 'malformed',
      detail: 'response did not name the model that produced it',
      tokens: 31,
      retryAfterMs: null,
    });

    await embedTexts({
      texts: ['a'],
      client,
      sleep: async () => {},
      onSpend: (report) => reports.push(report),
    });

    expect(reports).toHaveLength(1);
    expect(reports[0].usage.inputTokens).toBe(31);
    expect(reports[0].model).toBe('voyage-4-lite');
  });
});
