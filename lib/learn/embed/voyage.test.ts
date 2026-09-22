import { describe, expect, it, vi } from 'vitest';
import {
  EMBEDDING_DIMENSIONS,
  embeddingRequestBody,
  parseEmbeddingResponse,
  retryAfterMs,
  voyageClient,
} from './voyage';

/**
 * The provider boundary, checked without a network.
 *
 * `fetch` is handed in, so nothing here resolves a host or spends a token.
 * What is worth checking is everything between the HTTP status and the
 * vectors: the width of what comes back, that there is one vector per text,
 * and that a 429 is told apart from a key that was refused. A short batch is
 * the dangerous one -- it would pair every vector after the gap with the wrong
 * segment, and nothing downstream could notice.
 */

function vector(fill = 0.1, length = EMBEDDING_DIMENSIONS): number[] {
  return new Array(length).fill(fill);
}

function body(count: number, model = 'voyage-4-lite', tokens = 42) {
  return {
    object: 'list',
    data: Array.from({ length: count }, (_, index) => ({
      object: 'embedding',
      embedding: vector(index / 100),
      index,
    })),
    model,
    usage: { total_tokens: tokens },
  };
}

function responding(init: { status?: number; json?: unknown; text?: string; headers?: Record<string, string> }) {
  return vi.fn(async () =>
    new Response(init.text ?? JSON.stringify(init.json ?? {}), {
      status: init.status ?? 200,
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    }),
  ) as unknown as typeof fetch;
}

describe('the request', () => {
  it('asks for the width the column takes, and says which side of the search it is', () => {
    const sent = embeddingRequestBody({
      texts: ['a', 'b'],
      model: 'voyage-4-lite',
      inputType: 'query',
    });

    expect(sent.input).toEqual(['a', 'b']);
    expect(sent.model).toBe('voyage-4-lite');
    expect(sent.input_type).toBe('query');
    expect(sent.output_dimension).toBe(EMBEDDING_DIMENSIONS);
    expect(sent.truncation).toBe(true);
  });

  it('sends the key as a bearer token', async () => {
    const fetchImpl = responding({ json: body(1) });
    await voyageClient('vk-test', fetchImpl)({
      texts: ['a'],
      model: 'voyage-4-lite',
      inputType: 'document',
    });

    const [, init] = vi.mocked(fetchImpl).mock.calls[0];
    expect((init?.headers as Record<string, string>).authorization).toBe('Bearer vk-test');
    expect(init?.method).toBe('POST');
  });
});

describe('reading the response', () => {
  it('returns the vectors in the order the texts were given', () => {
    const result = parseEmbeddingResponse(body(3), 3);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.vectors).toHaveLength(3);
    expect(result.vectors[1][0]).toBeCloseTo(0.01);
    expect(result.model).toBe('voyage-4-lite');
    expect(result.tokens).toBe(42);
  });

  it('puts a vector back where its index says, not where it arrived', () => {
    const shuffled = body(3);
    shuffled.data.reverse();

    const result = parseEmbeddingResponse(shuffled, 3);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.vectors[0][0]).toBeCloseTo(0);
    expect(result.vectors[2][0]).toBeCloseTo(0.02);
  });

  it('refuses a batch that came back short', () => {
    const result = parseEmbeddingResponse(body(2), 3);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('malformed');
    expect(result.detail).toContain('3');
    // The call still cost what it cost.
    expect(result.tokens).toBe(42);
  });

  it('refuses a vector of the wrong width', () => {
    const wrong = body(1);
    wrong.data[0].embedding = vector(0.1, 1536);

    const result = parseEmbeddingResponse(wrong, 1);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('malformed');
    expect(result.detail).toContain('1536');
  });

  it('refuses a response that does not name its model', () => {
    const anonymous = { ...body(1), model: undefined };

    const result = parseEmbeddingResponse(anonymous, 1);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('malformed');
  });

  it('refuses a body of another shape entirely', () => {
    expect(parseEmbeddingResponse({ error: 'nope' }, 1).ok).toBe(false);
  });
});

describe('when the provider says no', () => {
  it('reads a rate limit and the wait it asked for', async () => {
    const client = voyageClient('vk-test', responding({ status: 429, headers: { 'retry-after': '3' } }));

    const result = await client({ texts: ['a'], model: 'voyage-4-lite', inputType: 'document' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('rate-limited');
    expect(result.retryAfterMs).toBe(3000);
  });

  it('calls a rejected key refused rather than broken', async () => {
    const client = voyageClient('vk-bad', responding({ status: 401 }));

    const result = await client({ texts: ['a'], model: 'voyage-4-lite', inputType: 'document' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('refused');
  });

  it('calls a server fault an error, which is the one worth asking again about', async () => {
    const client = voyageClient('vk-test', responding({ status: 503, text: 'upstream down' }));

    const result = await client({ texts: ['a'], model: 'voyage-4-lite', inputType: 'document' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('error');
    expect(result.detail).toContain('503');
  });

  it('does not throw when the connection drops', async () => {
    const client = voyageClient('vk-test', (async () => {
      throw new Error('socket hang up');
    }) as unknown as typeof fetch);

    const result = await client({ texts: ['a'], model: 'voyage-4-lite', inputType: 'document' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('error');
  });

  it('does not throw when 200 is not JSON', async () => {
    const client = voyageClient('vk-test', responding({ text: '<html>maintenance</html>' }));

    const result = await client({ texts: ['a'], model: 'voyage-4-lite', inputType: 'document' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('malformed');
  });
});

describe('retry-after', () => {
  it('reads seconds', () => {
    expect(retryAfterMs('12')).toBe(12_000);
  });

  it('reads an HTTP date, as a distance from now', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    expect(retryAfterMs('Thu, 01 Jan 2026 00:00:30 GMT', now)).toBe(30_000);
  });

  it('treats anything it cannot read as absent', () => {
    expect(retryAfterMs('soon')).toBeNull();
    expect(retryAfterMs(null)).toBeNull();
  });
});
