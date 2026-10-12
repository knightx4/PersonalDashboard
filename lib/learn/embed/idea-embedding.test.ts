import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_USAGE } from '@/lib/core/spend/pricing';
import type { EmbedInput, EmbedOutcome } from './embed';
import { embedIdeaClaim, embedIdeaClaims } from './idea-embedding';

/**
 * The embedding every Learn idea is saved with (plan #1853): one vector per
 * claim in order, nothing that throws, and a spend row under 'embed-idea'.
 */

const embedTexts = vi.fn<(input: EmbedInput) => Promise<EmbedOutcome>>();
vi.mock('./embed', () => ({ embedTexts: (input: EmbedInput) => embedTexts(input) }));

const vector = (seed: number) => Array.from({ length: 1024 }, (_, index) => (index === 0 ? seed : 0));

function client() {
  const spend: { schema: string; table: string; row: Record<string, unknown> }[] = [];
  const learn = {
    schema: (schema: string) => ({
      from: (table: string) => ({
        insert: async (row: Record<string, unknown>) => {
          spend.push({ schema, table, row });
          return { error: null };
        },
      }),
    }),
  };
  return { learn: learn as never, spend };
}

beforeEach(() => {
  embedTexts.mockReset();
  vi.restoreAllMocks();
});

describe('embedding the claims of ideas being saved', () => {
  it('gives each claim its own vector, in order, with the model that made it', async () => {
    embedTexts.mockImplementation(async (input) => {
      input.onSpend?.({ model: 'voyage-4-lite', usage: { ...EMPTY_USAGE, inputTokens: 130 } });
      return { ok: true, vectors: [vector(1), vector(2)], model: 'voyage-4-lite', tokens: 130 };
    });
    const { learn } = client();

    const rows = await embedIdeaClaims(learn, 'user-1', ['First claim.', 'Second claim.']);

    expect(embedTexts.mock.calls[0]![0].texts).toEqual(['First claim.', 'Second claim.']);
    expect(embedTexts.mock.calls[0]![0].inputType).toBe('document');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.embedding!.startsWith('[1,0,')).toBe(true);
    expect(rows[1]!.embedding!.startsWith('[2,0,')).toBe(true);
    expect(rows.map((row) => row.embedding_model)).toEqual(['voyage-4-lite', 'voyage-4-lite']);
  });

  it('records what the call cost under embed-idea, against the owner', async () => {
    embedTexts.mockImplementation(async (input) => {
      input.onSpend?.({ model: 'voyage-4-lite', usage: { ...EMPTY_USAGE, inputTokens: 65 } });
      return { ok: true, vectors: [vector(1)], model: 'voyage-4-lite', tokens: 65 };
    });
    const { learn, spend } = client();

    await embedIdeaClaim(learn, 'user-1', 'A claim.');

    expect(spend).toHaveLength(1);
    expect(spend[0]).toMatchObject({
      schema: 'core',
      table: 'model_spend',
      row: { user_id: 'user-1', module: 'learn', operation: 'embed-idea', input_tokens: 65 },
    });
  });

  it('leaves both columns null when the call fails, and still records what it spent', async () => {
    embedTexts.mockImplementation(async (input) => {
      input.onSpend?.({ model: 'voyage-4-lite', usage: { ...EMPTY_USAGE, inputTokens: 40 } });
      return { ok: false, reason: 'malformed', detail: 'bad body', tokens: 40 };
    });
    const { learn, spend } = client();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const rows = await embedIdeaClaims(learn, 'user-1', ['One.', 'Two.']);

    expect(rows).toEqual([
      { embedding: null, embedding_model: null },
      { embedding: null, embedding_model: null },
    ]);
    expect(spend).toHaveLength(1);
  });

  it('never throws, even when the call does', async () => {
    embedTexts.mockRejectedValue(new Error('network down'));
    const { learn } = client();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(embedIdeaClaim(learn, 'user-1', 'A claim.')).resolves.toEqual({
      embedding: null,
      embedding_model: null,
    });
  });

  it('makes no call for no claims', async () => {
    const { learn } = client();
    expect(await embedIdeaClaims(learn, 'user-1', [])).toEqual([]);
    expect(embedTexts).not.toHaveBeenCalled();
  });
});
