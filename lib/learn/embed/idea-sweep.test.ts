import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_USAGE } from '@/lib/core/spend/pricing';
import type { EmbedInput, EmbedOutcome } from './embed';
import { embedIdeasOverRest } from './idea-sweep';

/**
 * The daily fill-in (plan #1854): a run leaves no idea without a vector, each
 * is stored with its own, and the spend lands under 'embed-idea'.
 */

const embedTexts = vi.fn<(input: EmbedInput) => Promise<EmbedOutcome>>();
vi.mock('./embed', () => ({ embedTexts: (input: EmbedInput) => embedTexts(input) }));

const vector = (seed: number) => Array.from({ length: 1024 }, (_, index) => (index === 0 ? seed : 0));

type Row = { id: string; claim: string; embedding: string | null; embedding_model: string | null };

function client(rows: Row[]) {
  const spend: Record<string, unknown>[] = [];
  const learn = {
    from: () => {
      let patch: Partial<Row> | null = null;
      const filters: Record<string, string> = {};
      const builder: Record<string, unknown> = {
        select: () => builder,
        update: (value: Partial<Row>) => ((patch = value), builder),
        or: () => builder,
        neq: () => builder,
        order: () => builder,
        eq: (column: string, value: string) => ((filters[column] = value), builder),
        limit: (n: number) =>
          Promise.resolve({
            data: rows
              .filter((r) => r.embedding === null)
              .slice(0, n)
              .map((r) => ({ id: r.id, claim: r.claim })),
            error: null,
          }),
        then: (resolve: (v: unknown) => void) => {
          const hit = rows.filter((r) => r.id === filters.id && r.claim === filters.claim);
          for (const r of hit) Object.assign(r, patch);
          resolve({ data: hit.map((r) => ({ id: r.id })), error: null });
        },
      };
      return builder;
    },
    schema: () => ({
      from: () => ({
        insert: async (row: Record<string, unknown>) => (spend.push(row), { error: null }),
      }),
    }),
  };
  return { learn: learn as never, spend };
}

beforeEach(() => {
  embedTexts.mockReset();
});

describe('embedIdeasOverRest', () => {
  it('gives every due idea its own vector and records one spend line', async () => {
    const rows: Row[] = [
      { id: 'a', claim: 'First claim', embedding: null, embedding_model: null },
      { id: 'b', claim: 'Second claim', embedding: null, embedding_model: null },
    ];
    const { learn, spend } = client(rows);
    embedTexts.mockImplementation(async (input) => {
      input.onSpend?.({ model: 'voyage-4-lite', usage: { ...EMPTY_USAGE, inputTokens: 40 } });
      return { ok: true, vectors: [vector(1), vector(2)], model: 'voyage-4-lite', tokens: 40 };
    });

    const result = await embedIdeasOverRest(learn, 'user-1');

    expect(result).toMatchObject({ embedded: 2, tokens: 40, stopped: null });
    expect(embedTexts.mock.calls[0][0].texts).toEqual(['First claim', 'Second claim']);
    expect(rows[0].embedding?.startsWith('[1,')).toBe(true);
    expect(rows[1].embedding?.startsWith('[2,')).toBe(true);
    expect(rows.every((r) => r.embedding_model === 'voyage-4-lite')).toBe(true);
    expect(spend).toHaveLength(1);
    expect(spend[0]).toMatchObject({ user_id: 'user-1', module: 'learn', operation: 'embed-idea' });
  });

  it('stops and writes nothing when the provider fails', async () => {
    const rows: Row[] = [{ id: 'a', claim: 'First claim', embedding: null, embedding_model: null }];
    const { learn } = client(rows);
    embedTexts.mockResolvedValue({ ok: false, reason: 'error', detail: 'down', tokens: 0 });

    const result = await embedIdeasOverRest(learn, 'user-1');

    expect(result.embedded).toBe(0);
    expect(result.stopped?.reason).toBe('error');
    expect(rows[0].embedding).toBeNull();
  });
});
