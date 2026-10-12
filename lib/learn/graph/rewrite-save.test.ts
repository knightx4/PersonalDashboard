import { describe, expect, it, vi } from 'vitest';
import { rewrittenClaimUpdate } from './rewrite-save';

// The rewritten claim is embedded again (plan #1853).
vi.mock('@/lib/learn/embed/idea-embedding', () => import('@/tests/stubs/idea-embedding'));

describe('rewrittenClaimUpdate', () => {
  it('saves the new wording with its own embedding, keeping the first wording', async () => {
    const update = await rewrittenClaimUpdate(
      {} as never,
      'user-1',
      { claim: 'The app wrote this.', claimOriginal: null },
      '  In my own words.  ',
    );

    expect(update).toMatchObject({
      claim: 'In my own words.',
      claim_original: 'The app wrote this.',
      embedding: 'vector of In my own words.',
      embedding_model: 'voyage-4-lite',
    });
  });
});

describe('rewrittenClaimUpdate when the embedding fails', () => {
  it('clears the old vector rather than keeping one for the replaced sentence', async () => {
    vi.resetModules();
    vi.doMock('@/lib/learn/embed/idea-embedding', () => ({
      embedIdeaClaim: async () => ({ embedding: null, embedding_model: null }),
    }));
    const { rewrittenClaimUpdate: failing } = await import('./rewrite-save');

    const update = await failing(
      {} as never,
      'user-1',
      { claim: 'Mine.', claimOriginal: 'The app wrote this.' },
      'Mine, again.',
    );

    expect(update).toMatchObject({ claim: 'Mine, again.', embedding: null, embedding_model: null });
    expect(update).not.toHaveProperty('claim_original');
  });
});
