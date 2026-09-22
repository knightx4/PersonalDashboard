import { describe, expect, it } from 'vitest';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { EMBEDDING_DIMENSIONS, type EmbeddingClient } from '@/lib/learn/embed/voyage';
import {
  DEFAULT_CANDIDATE_LIMIT,
  DEFAULT_MIN_SIMILARITY,
  findNearestSegments,
  nearestSegmentsForClaim,
  rankNearest,
  type EmbedClaim,
  type NearbySegment,
  type SegmentIndex,
} from '@/lib/learn/catalogue/nearest';

/**
 * What this module promises its caller.
 *
 * The function this calls was exercised against the live index when it was
 * built, with the same four segments used below: at the default floor a claim
 * pointing at the first one gets back the exact match and the near one and
 * nothing else, and a claim pointing somewhere the catalogue does not go gets
 * back nothing at all.
 *
 * The vectors here are written by hand and the index computes real cosine over
 * them, so the ordering is a property of the numbers rather than of the order
 * the fake happens to return rows in. Four dimensions rather than 1024,
 * because the arithmetic is the same and the expected similarities are ones
 * you can check in your head: [1,0,0,0] against [1,1,0,0] is 1/sqrt(2). The
 * fourth dimension is what a claim nothing covers points along, and no
 * segment below has any of it.
 */

function cosine(left: number[], right: number[]): number {
  let dot = 0;
  let leftLength = 0;
  let rightLength = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftLength += left[index] ** 2;
    rightLength += right[index] ** 2;
  }
  return dot / (Math.sqrt(leftLength) * Math.sqrt(rightLength));
}

const CLAIM_VECTOR = [1, 0, 0, 0];

/** Four segments at known distances from CLAIM_VECTOR. */
const CATALOGUE: { heading: string; vector: number[]; similarity: number }[] = [
  { heading: 'Exact', vector: [1, 0, 0, 0], similarity: 1 },
  { heading: 'Near', vector: [1, 1, 0, 0], similarity: Math.SQRT1_2 },
  { heading: 'Weak', vector: [1, 2, 2, 0], similarity: 1 / 3 },
  { heading: 'Unrelated', vector: [0, 1, 0, 0], similarity: 0 },
];

function segment(heading: string, similarity: number, overrides: Partial<NearbySegment> = {}): NearbySegment {
  return {
    segmentId: `segment-${heading}`,
    itemId: 'item-1',
    ordinal: CATALOGUE.findIndex((row) => row.heading === heading),
    heading,
    sectionAnchor: heading.toLowerCase(),
    tStartSeconds: null,
    tEndSeconds: null,
    text: `the ${heading} section`,
    embeddingModel: 'voyage-4-lite',
    similarity,
    item: { title: 'An article', kind: 'article', canonicalUrl: 'https://example.invalid/a' },
    ...overrides,
  };
}

/**
 * A catalogue in memory.
 *
 * It deliberately ignores the floor it is given and returns rows worst first.
 * The caller-facing function has to produce the same answer either way, which
 * is what "the floor holds whichever index answered" means.
 */
function memoryIndex(
  rows = CATALOGUE,
  model = 'voyage-4-lite',
): SegmentIndex & { asked: { limit: number; minSimilarity: number; embeddingModel: string | null }[] } {
  const asked: { limit: number; minSimilarity: number; embeddingModel: string | null }[] = [];
  return {
    asked,
    async nearest({ vector, limit, minSimilarity, embeddingModel }) {
      asked.push({ limit, minSimilarity, embeddingModel });
      return rows
        .map((row) => segment(row.heading, cosine(vector, row.vector), { embeddingModel: model }))
        .sort((left, right) => left.similarity - right.similarity)
        .slice(0, limit);
    },
  };
}

/** An embedder that answers with whatever vector the test wants. */
function fakeEmbed(vector = CLAIM_VECTOR, model = 'voyage-4-lite'): EmbedClaim & { claims: string[] } {
  const claims: string[] = [];
  const embed: EmbedClaim = async ({ text, onSpend }) => {
    claims.push(text);
    onSpend?.({
      model,
      usage: { inputTokens: 12, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
    });
    return { ok: true, vector, model, tokens: 12 };
  };
  return Object.assign(embed, { claims });
}

describe('the floor and the ordering', () => {
  it('puts the closest first whatever order it was given them in', () => {
    const given = [segment('Weak', 0.6), segment('Exact', 0.95), segment('Near', 0.8)];

    expect(rankNearest(given, { minSimilarity: 0 }).map((row) => row.heading)).toEqual([
      'Exact',
      'Near',
      'Weak',
    ]);
  });

  it('drops everything below the floor and keeps the distance on what is left', () => {
    const ranked = rankNearest(CATALOGUE.map((row) => segment(row.heading, row.similarity)));

    expect(ranked.map((row) => row.heading)).toEqual(['Exact', 'Near']);
    expect(ranked.map((row) => row.similarity)).toEqual([1, Math.SQRT1_2]);
  });

  it('returns nothing rather than the least bad of what it has', () => {
    const weak = [segment('Weak', 0.31), segment('Unrelated', 0.02)];

    expect(rankNearest(weak)).toEqual([]);
  });

  it('caps what it returns, so a press cannot cost more than the cap', () => {
    const many = Array.from({ length: 60 }, (_, index) => segment(`s${index}`, 0.9));

    expect(rankNearest(many)).toHaveLength(DEFAULT_CANDIDATE_LIMIT);
    expect(rankNearest(many, { limit: 5 })).toHaveLength(5);
  });

  it('drops a row whose similarity is not a number rather than sorting it', () => {
    const ranked = rankNearest([segment('Exact', 1), segment('Broken', Number.NaN)]);

    expect(ranked.map((row) => row.heading)).toEqual(['Exact']);
  });
});

describe('the segments nearest a claim', () => {
  it('returns them closest first, each with its similarity', async () => {
    const embed = fakeEmbed();
    const index = memoryIndex();

    const outcome = await nearestSegmentsForClaim({ index, embed }, 'water expands as it freezes');

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(embed.claims).toEqual(['water expands as it freezes']);
    expect(outcome.segments.map((row) => row.heading)).toEqual(['Exact', 'Near']);
    expect(outcome.segments[0].similarity).toBeCloseTo(1, 10);
    expect(outcome.segments[1].similarity).toBeCloseTo(Math.SQRT1_2, 10);
    expect(outcome.segments[0].text).toBe('the Exact section');
    expect(outcome.model).toBe('voyage-4-lite');
    expect(outcome.tokens).toBe(12);
  });

  it('returns an empty list for a claim the catalogue does not cover', async () => {
    // Orthogonal to every segment in the catalogue, which is a claim about
    // something nothing here is about.
    const outcome = await nearestSegmentsForClaim(
      { index: memoryIndex(), embed: fakeEmbed([0, 0, 0, 1]) },
      'the Treaty of Westphalia ended the Thirty Years War',
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.segments).toEqual([]);
    expect(outcome.models).toEqual([]);
  });

  it('holds the floor even when the index hands back weak rows anyway', async () => {
    const index = memoryIndex();

    const outcome = await nearestSegmentsForClaim({ index, embed: fakeEmbed() }, 'a claim');

    // The fake was asked for the floor and ignored it, exactly as an index
    // written against an older version of the function might.
    expect(index.asked[0].minSimilarity).toBe(DEFAULT_MIN_SIMILARITY);
    expect(outcome.ok && outcome.segments.every((row) => row.similarity >= DEFAULT_MIN_SIMILARITY)).toBe(
      true,
    );
  });

  it('asks the index for the capped number of candidates, and for all models by default', async () => {
    const index = memoryIndex();

    await nearestSegmentsForClaim({ index, embed: fakeEmbed() }, 'a claim');

    expect(index.asked).toEqual([
      { limit: DEFAULT_CANDIDATE_LIMIT, minSimilarity: DEFAULT_MIN_SIMILARITY, embeddingModel: null },
    ]);
  });

  it('says which models embedded what came back', async () => {
    const outcome = await nearestSegmentsForClaim(
      { index: memoryIndex(CATALOGUE, 'voyage-4-large'), embed: fakeEmbed() },
      'a claim',
    );

    // A claim embedded by one Voyage model against a catalogue embedded by
    // another is a comparison worth making, so these rows are kept and the
    // model that produced them is said out loud rather than filtered on.
    expect(outcome.ok && outcome.models).toEqual(['voyage-4-large']);
  });

  it('passes a filter through when the caller wants one model only', async () => {
    const index = memoryIndex();

    await nearestSegmentsForClaim(
      { index, embed: fakeEmbed() },
      'a claim',
      { embeddingModel: 'voyage-4-lite', limit: 5, minSimilarity: 0.9 },
    );

    expect(index.asked).toEqual([{ limit: 5, minSimilarity: 0.9, embeddingModel: 'voyage-4-lite' }]);
  });
});

describe('when it cannot answer', () => {
  it('reports the embedding failure and never reads the index', async () => {
    const index = memoryIndex();
    const embed: EmbedClaim = async () => ({
      ok: false,
      reason: 'no-key',
      detail: 'EMBEDDING_API_KEY is not set on this deployment',
      tokens: 0,
    });

    const outcome = await nearestSegmentsForClaim({ index, embed }, 'a claim');

    expect(outcome).toEqual({
      ok: false,
      reason: 'no-key',
      detail: 'EMBEDDING_API_KEY is not set on this deployment',
      tokens: 0,
    });
    expect(index.asked).toEqual([]);
  });

  it('reports a read that failed, and still says what the claim cost', async () => {
    const index: SegmentIndex = {
      async nearest() {
        throw new Error('relation does not exist');
      },
    };

    const outcome = await nearestSegmentsForClaim({ index, embed: fakeEmbed() }, 'a claim');

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('index');
    expect(outcome.detail).toBe('relation does not exist');
    // The embedding call happened before the read did.
    expect(outcome.tokens).toBe(12);
  });
});

describe('against the live index', () => {
  it('embeds the claim as a query and sends the vector as a literal', async () => {
    const seen: { inputType: string; texts: string[] }[] = [];
    const client: EmbeddingClient = async ({ texts, model, inputType }) => {
      seen.push({ inputType, texts });
      const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
      vector[0] = 1;
      return { ok: true, vectors: [vector], model, tokens: 9 };
    };

    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    const supabase = {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        return { data: [], error: null };
      },
    } as unknown as LearnSupabaseClient;

    const outcome = await findNearestSegments(supabase, 'ice floats', { client });

    // Voyage prepends a different instruction to each side, and a claim
    // embedded as a document retrieves worse without ever failing.
    expect(seen).toEqual([{ inputType: 'query', texts: ['ice floats'] }]);
    expect(calls[0].fn).toBe('nearest_catalogue_segments');
    expect(calls[0].args.query_embedding).toBe(`[${['1', ...new Array(1023).fill('0')].join(',')}]`);
    expect(calls[0].args.match_limit).toBe(DEFAULT_CANDIDATE_LIMIT);
    expect(calls[0].args.min_similarity).toBe(DEFAULT_MIN_SIMILARITY);
    expect(outcome.ok && outcome.segments).toEqual([]);
  });

  it('reports the error when the function refuses rather than throwing', async () => {
    const client: EmbeddingClient = async ({ model }) => {
      const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0.01);
      return { ok: true, vectors: [vector], model, tokens: 9 };
    };

    const supabase = {
      rpc: async () => ({ data: null, error: { message: 'permission denied for function' } }),
    } as unknown as LearnSupabaseClient;

    const outcome = await findNearestSegments(supabase, 'ice floats', { client });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('index');
    expect(outcome.detail).toBe('permission denied for function');
  });
});
