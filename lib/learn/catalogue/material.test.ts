import { describe, expect, it } from 'vitest';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import {
  commitmentLabel,
  loadClaimMaterial,
  materialForClaim,
  orderForClaim,
  tableMaterialStore,
  type ClaimMaterial,
  type MaterialStore,
} from '@/lib/learn/catalogue/material';

/**
 * What the list for a claim promises.
 *
 * The step's acceptance is two things: material comes back in the order worth
 * taking, each row carrying its reason and how sure the match is, and a claim
 * with none says which of the two reasons it is. The second is the one with
 * something to get wrong, so both absences are reached from the pass rather
 * than from a page.
 *
 * No database, as everywhere else in this directory. The ordering runs over
 * rows built by hand, and the live store is checked against a client that
 * records the statements it was handed.
 */

const ARTICLE = {
  id: 'item-article',
  title: 'Fractional-reserve banking',
  author: null,
  kind: 'article',
  canonicalUrl: 'https://en.wikipedia.org/wiki/Fractional-reserve_banking',
  durationSeconds: null,
};

const LECTURE = {
  id: 'item-lecture',
  title: 'Lecture 7: Money and Banking',
  author: 'MIT OpenCourseWare',
  kind: 'video',
  canonicalUrl: 'https://www.youtube.com/watch?v=abc123',
  durationSeconds: 4800,
};

function section(overrides: Partial<ClaimMaterial> = {}): ClaimMaterial {
  return {
    segmentId: 'segment-section',
    ordinal: 2,
    basis: 'Lays out how a reserve requirement caps the multiplier.',
    confidence: 'verified',
    model: 'claude-haiku-4-5',
    shape: 'section',
    where: 'Money creation',
    lengthChars: 5500,
    tStartSeconds: null,
    tEndSeconds: null,
    item: ARTICLE,
    ...overrides,
  };
}

function clip(overrides: Partial<ClaimMaterial> = {}): ClaimMaterial {
  return {
    segmentId: 'segment-clip',
    ordinal: 3,
    basis: 'Works the deposit multiplier through on the board.',
    confidence: 'verified',
    model: 'claude-haiku-4-5',
    shape: 'clip',
    where: '12:04–18:30',
    lengthChars: 4200,
    tStartSeconds: 724,
    tEndSeconds: 1110,
    item: LECTURE,
    ...overrides,
  };
}

function whole(overrides: Partial<ClaimMaterial> = {}): ClaimMaterial {
  return {
    segmentId: 'segment-whole',
    ordinal: 0,
    basis: 'The lecture is about how banks create deposits.',
    confidence: 'verified',
    model: 'claude-haiku-4-5',
    shape: 'whole',
    where: null,
    // What an uncut video has instead of a transcript: its title and blurb.
    lengthChars: 240,
    tStartSeconds: null,
    tEndSeconds: null,
    item: LECTURE,
    ...overrides,
  };
}

function ids(rows: readonly ClaimMaterial[]): string[] {
  return rows.map((row) => row.segmentId);
}

/** A store holding what the tables would hold. */
function memoryStore(input: {
  links?: ClaimMaterial[];
  searchable?: boolean;
}): { store: MaterialStore; asked: string[] } {
  const asked: string[] = [];

  return {
    asked,
    store: {
      async forClaim(conceptId) {
        asked.push(`forClaim:${conceptId}`);
        return input.links ?? [];
      },
      async anySearchable() {
        asked.push('anySearchable');
        return input.searchable ?? false;
      },
    },
  };
}

describe('the order material is offered in', () => {
  it('puts a section first for somebody still recognising the idea', () => {
    expect(ids(orderForClaim('recognise', [whole(), clip(), section()]))).toEqual([
      'segment-section',
      'segment-clip',
      'segment-whole',
    ]);
  });

  it('puts the worked example first once the questions are applied ones', () => {
    expect(ids(orderForClaim('apply', [whole(), section(), clip()]))).toEqual([
      'segment-clip',
      'segment-section',
      'segment-whole',
    ]);
  });

  it('leaves a whole uncut work last, however short its text is', () => {
    // The length term would otherwise promote it: 240 characters of title and
    // description reads as a one-minute commitment for a fifty-minute lecture.
    const order = orderForClaim('apply', [whole(), section({ lengthChars: 40_000 })]);
    expect(ids(order)).toEqual(['segment-section', 'segment-whole']);
  });

  it('prefers a match a model argued for over one nothing read', () => {
    const near = section({ segmentId: 'segment-near', confidence: 'unverified', model: null });
    expect(ids(orderForClaim('recognise', [near, section()]))).toEqual([
      'segment-section',
      'segment-near',
    ]);
  });

  it('breaks a tie on the shorter commitment', () => {
    const long = section({ segmentId: 'segment-long', lengthChars: 12_000 });
    expect(ids(orderForClaim('recognise', [long, section()]))).toEqual([
      'segment-section',
      'segment-long',
    ]);
  });

  it('settles two equal rows the same way every time', () => {
    const first = section({ segmentId: 'segment-a', ordinal: 1 });
    const second = section({ segmentId: 'segment-b', ordinal: 4 });

    expect(ids(orderForClaim('recognise', [second, first]))).toEqual([
      'segment-a',
      'segment-b',
    ]);
    expect(ids(orderForClaim('recognise', [first, second]))).toEqual([
      'segment-a',
      'segment-b',
    ]);
  });

  it('has no shape preference at the rung nothing can read off a column', () => {
    // `defend` wants something that argues a position, which no column says.
    // So confidence and length decide, and the shapes keep their own order.
    const near = clip({ segmentId: 'segment-near', confidence: 'unverified', model: null });
    expect(ids(orderForClaim('defend', [near, section()]))).toEqual([
      'segment-section',
      'segment-near',
    ]);
  });
});

describe('what a row costs you', () => {
  it('counts a clip as its own span, not the lecture it came from', () => {
    expect(commitmentLabel(clip())).toBe('about 6 min');
  });

  it('runs an open-ended clip to the end of the work', () => {
    expect(commitmentLabel(clip({ tEndSeconds: null }))).toBe('about 68 min');
  });

  it('counts a whole uncut work as the whole work', () => {
    expect(commitmentLabel(whole())).toBe('about 80 min');
  });

  it('estimates an article section from its text', () => {
    expect(commitmentLabel(section({ lengthChars: 5500 }))).toBe('about 5 min');
  });

  it('never offers something as taking no time at all', () => {
    expect(commitmentLabel(section({ lengthChars: 12 }))).toBe('about 1 min');
  });
});

describe('a claim with nothing found for it', () => {
  it('says the catalogue is empty when there is nothing to search', async () => {
    const { store } = memoryStore({ links: [], searchable: false });

    await expect(
      materialForClaim(store, { conceptId: 'concept-1', rung: 'recognise' }),
    ).resolves.toEqual({ material: [], absence: 'catalogue-empty' });
  });

  it('says nothing matched when the catalogue holds material and none is linked', async () => {
    const { store } = memoryStore({ links: [], searchable: true });

    await expect(
      materialForClaim(store, { conceptId: 'concept-1', rung: 'recognise' }),
    ).resolves.toEqual({ material: [], absence: 'nothing-matched' });
  });

  it('does not ask what the catalogue holds when the claim has material', async () => {
    const { store, asked } = memoryStore({ links: [section()], searchable: true });

    const view = await materialForClaim(store, { conceptId: 'concept-1', rung: 'recognise' });

    expect(view.absence).toBeNull();
    expect(ids(view.material)).toEqual(['segment-section']);
    expect(asked).toEqual(['forClaim:concept-1']);
  });
});

type Reply = { data: unknown; error: { code?: string; message: string } | null };

/** A client that records the statements it was handed. */
function recordingClient(replies: Record<string, Reply>) {
  const calls: { table: string; columns: string; filters: [string, unknown][] }[] = [];

  const client = {
    from(table: string) {
      const call = { table, columns: '', filters: [] as [string, unknown][] };
      const answer = () => {
        calls.push(call);
        return Promise.resolve(replies[call.table] ?? { data: null, error: null });
      };

      const builder = {
        select(columns: string) {
          call.columns = columns;
          return builder;
        },
        eq(column: string, value: unknown) {
          call.filters.push([column, value]);
          return builder;
        },
        not(column: string, operator: string, value: unknown) {
          call.filters.push([column, `${operator} ${value}`]);
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        maybeSingle: answer,
        then: (resolve: (value: Reply) => unknown, reject?: (reason: unknown) => unknown) =>
          answer().then(resolve, reject),
      };

      return builder;
    },
  };

  return { client: client as unknown as LearnSupabaseClient, calls };
}

describe('the live store', () => {
  it('reads one account’s links for one claim, with the work behind each', async () => {
    const { client, calls } = recordingClient({
      catalogue_links: {
        data: [
          {
            basis: 'Derives the multiplier from the reserve requirement.',
            confidence: 'verified',
            model: 'claude-haiku-4-5',
            // An array, which is the shape PostgREST sometimes answers with.
            catalogue_segments: [
              {
                id: 'segment-clip',
                ordinal: 3,
                heading: null,
                section_anchor: null,
                t_start_seconds: 724,
                t_end_seconds: 1110,
                text: 'So when the bank lends that deposit out again…',
                catalogue_items: {
                  id: 'item-lecture',
                  title: LECTURE.title,
                  author: LECTURE.author,
                  kind: 'video',
                  canonical_url: LECTURE.canonicalUrl,
                  duration_seconds: 4800,
                },
              },
            ],
          },
        ],
        error: null,
      },
    });

    const rows = await tableMaterialStore(client, 'user-1').forClaim('concept-1');

    expect(calls[0].filters).toEqual([
      ['user_id', 'user-1'],
      ['concept_id', 'concept-1'],
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      segmentId: 'segment-clip',
      shape: 'clip',
      where: '12:04–18:30',
      confidence: 'verified',
      model: 'claude-haiku-4-5',
      item: { id: 'item-lecture', title: LECTURE.title, durationSeconds: 4800 },
    });
  });

  it('reads an anchored segment as the section it is', async () => {
    const { client } = recordingClient({
      catalogue_links: {
        data: [
          {
            basis: 'States the claim and says why it holds.',
            confidence: 'unverified',
            model: null,
            catalogue_segments: {
              id: 'segment-section',
              ordinal: 2,
              heading: 'Money creation',
              section_anchor: '#Money_creation',
              t_start_seconds: null,
              t_end_seconds: null,
              text: 'Banks create deposits when they lend.',
              catalogue_items: {
                id: 'item-article',
                title: ARTICLE.title,
                author: null,
                kind: 'article',
                canonical_url: ARTICLE.canonicalUrl,
                duration_seconds: null,
              },
            },
          },
        ],
        error: null,
      },
    });

    const rows = await tableMaterialStore(client, 'user-1').forClaim('concept-1');

    expect(rows[0]).toMatchObject({ shape: 'section', where: 'Money creation', lengthChars: 37 });
  });

  it('counts only embedded segments as something a claim could reach', async () => {
    const { client, calls } = recordingClient({
      catalogue_segments: { data: null, error: null },
    });

    await expect(tableMaterialStore(client, 'user-1').anySearchable()).resolves.toBe(false);
    expect(calls[0].filters).toEqual([['embedding_model', 'is null']]);
  });

  it('raises what the read said rather than reporting an empty claim', async () => {
    const { client } = recordingClient({
      catalogue_links: {
        data: null,
        error: { code: '42501', message: 'new row violates row-level security policy' },
      },
    });

    await expect(
      loadClaimMaterial(client, 'user-1', { conceptId: 'concept-1', rung: 'recognise' }),
    ).rejects.toThrow('row-level security');
  });
});
