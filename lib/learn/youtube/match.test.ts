import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import {
  METADATA_SLICE_MS,
  STORE_CHUNK,
  embedVideoMetadata,
  metadataEmbedDeadline,
} from '@/lib/learn/youtube/match';

vi.mock('@/lib/learn/embed/embed', () => ({
  embedTexts: vi.fn(async ({ texts }: { texts: string[] }) => ({
    ok: true,
    vectors: texts.map(() => new Array(1024).fill(0.1)),
    model: 'test-model',
    tokens: texts.length,
  })),
}));

describe('metadataEmbedDeadline', () => {
  const started = 1_000_000;

  it('runs to the fixed point when listing finishes early', () => {
    expect(metadataEmbedDeadline(started, 175_000, started + 80_000)).toBe(started + 175_000);
  });

  it('keeps its full slice when listing runs to its deadline or past it', () => {
    const now = started + 125_000;
    expect(metadataEmbedDeadline(started, 175_000, now)).toBe(now + METADATA_SLICE_MS);
    expect(METADATA_SLICE_MS).toBeGreaterThanOrEqual(60_000);
  });
});

describe('embedVideoMetadata', () => {
  /** A client whose table hands out `total` unembedded videos, 128 at a time. */
  function fakeLearn(total: number, failOnCall?: number) {
    let left = total;
    const stores: number[] = [];
    const query = {
      select: () => query,
      eq: () => query,
      is: () => query,
      order: () => query,
      limit: async (n: number) => {
        const take = Math.min(n, left);
        return {
          data: Array.from({ length: take }, (_, i) => ({ id: `v${left - i}`, title: 'A title', description: null })),
          error: null,
        };
      },
    };
    const learn = {
      from: () => query,
      rpc: async (_name: string, args: { item_ids: string[] }) => {
        stores.push(args.item_ids.length);
        if (stores.length === failOnCall) return { data: null, error: { message: 'canceling statement due to statement timeout' } };
        left -= args.item_ids.length;
        return { data: args.item_ids.length, error: null };
      },
    } as unknown as LearnSupabaseClient;
    return { learn, stores };
  }

  beforeEach(() => {
    vi.stubEnv('EMBEDDING_API_KEY', 'test');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('writes each batch in chunks small enough for the statement timeout', async () => {
    const { learn, stores } = fakeLearn(200);
    const result = await embedVideoMetadata(learn, { deadline: Date.now() + 60_000 });
    expect(result).toEqual({ embedded: 200, stopped: null });
    expect(Math.max(...stores)).toBeLessThanOrEqual(STORE_CHUNK);
    expect(stores.reduce((a, b) => a + b, 0)).toBe(200);
  });

  it('stops with the reason rather than throwing when a write fails', async () => {
    const { learn } = fakeLearn(200, 3);
    const result = await embedVideoMetadata(learn, { deadline: Date.now() + 60_000 });
    expect(result.embedded).toBe(2 * STORE_CHUNK);
    expect(result.stopped).toMatch(/statement timeout/);
  });
});
