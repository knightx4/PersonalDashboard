import { describe, expect, it } from 'vitest';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import {
  commitmentLabel,
  loadClaimMaterial,
  materialForClaim,
  orderForClaim,
  tableMaterialStore,
  type ClaimMaterial,
  type ConsumedReading,
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
    model: 'claude-haiku-5-5',
    shape: 'section',
    where: 'Money creation',
    lengthChars: 5500,
    tStartSeconds: null,
    tEndSeconds: null,
    openUrl: `${ARTICLE.canonicalUrl}#Money_creation`,
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
    model: 'claude-haiku-5-5',
    shape: 'clip',
    where: '12:04–18:30',
    lengthChars: 4200,
    tStartSeconds: 724,
    tEndSeconds: 1110,
    openUrl: `${LECTURE.canonicalUrl}&t=724`,
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
    model: 'claude-haiku-5-5',
    shape: 'whole',
    where: null,
    // What an uncut video has instead of a transcript: its title and blurb.
    lengthChars: 240,
    tStartSeconds: null,
    tEndSeconds: null,
    openUrl: LECTURE.canonicalUrl,
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
  consumed?: ConsumedReading[];
}): { store: MaterialStore; asked: string[] } {
  const asked: string[] = [];

  return {
    asked,
    store: {
      async forClaim(conceptId) {
        asked.push(`forClaim:${conceptId}`);
        return input.links ?? [];
      },
      async consumed(openUrls) {
        asked.push('consumed');
        return (input.consumed ?? []).filter((reading) => openUrls.includes(reading.openUrl));
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
  const SEARCHED = '2026-09-20T09:00:00Z';

  it('says the catalogue is empty when there is nothing to search', async () => {
    const { store } = memoryStore({ links: [], searchable: false });

    await expect(
      materialForClaim(store, { conceptId: 'concept-1', rung: 'recognise', searchedAt: null }),
    ).resolves.toEqual({ material: [], absence: 'catalogue-empty' });
  });

  it('says the catalogue is empty ahead of saying nobody looked', async () => {
    const { store } = memoryStore({ links: [], searchable: false });

    // Both are true of a claim nobody has pressed while the catalogue is
    // empty, and only one of them is worth acting on: pressing the button
    // searches a catalogue with nothing in it.
    await expect(
      materialForClaim(store, { conceptId: 'concept-1', rung: 'recognise', searchedAt: SEARCHED }),
    ).resolves.toEqual({ material: [], absence: 'catalogue-empty' });
  });

  it('says nobody has looked when the claim has never been searched', async () => {
    const { store } = memoryStore({ links: [], searchable: true });

    await expect(
      materialForClaim(store, { conceptId: 'concept-1', rung: 'recognise', searchedAt: null }),
    ).resolves.toEqual({ material: [], absence: 'never-searched' });
  });

  it('says nothing matched only once something has searched', async () => {
    const { store } = memoryStore({ links: [], searchable: true });

    await expect(
      materialForClaim(store, { conceptId: 'concept-1', rung: 'recognise', searchedAt: SEARCHED }),
    ).resolves.toEqual({ material: [], absence: 'nothing-matched' });
  });

  it('does not ask what the catalogue holds when the claim has material', async () => {
    const { store, asked } = memoryStore({ links: [section()], searchable: true });

    const view = await materialForClaim(store, {
      conceptId: 'concept-1',
      rung: 'recognise',
      searchedAt: null,
    });

    expect(view.absence).toBeNull();
    expect(ids(view.material)).toEqual(['segment-section']);
    expect(asked).toEqual(['forClaim:concept-1', 'consumed']);
  });
});

/** A finished or abandoned reading of a segment, as the store hands it back. */
function readingOf(row: ClaimMaterial, overrides: Partial<ConsumedReading> = {}): ConsumedReading {
  return {
    catalogueItemId: row.item.id,
    canonicalUrl: row.item.canonicalUrl,
    openUrl: row.openUrl,
    ...overrides,
  };
}

describe('material you have already been through', () => {
  it('leaves out a segment you finished or gave up on', () => {
    const order = orderForClaim('recognise', [whole(), clip(), section()], [readingOf(clip())]);
    expect(ids(order)).toEqual(['segment-section', 'segment-whole']);
  });

  it('keeps another part of the same work you have not read', () => {
    // The lecture's whole segment and its clip are one source; only the clip's
    // address was read, so the rest of the lecture is still offered.
    const order = orderForClaim('apply', [clip(), whole()], [readingOf(clip())]);
    expect(ids(order)).toEqual(['segment-whole']);
  });

  it('counts a work you held before the catalogue did, by its URL', () => {
    const pasted = readingOf(section(), { catalogueItemId: null });
    expect(ids(orderForClaim('recognise', [section(), clip()], [pasted]))).toEqual(['segment-clip']);
  });

  it('does not count a different work that happens to open at the same address', () => {
    const other = readingOf(section(), { catalogueItemId: 'item-other', canonicalUrl: 'https://example.org' });
    expect(ids(orderForClaim('recognise', [section()], [other]))).toEqual(['segment-section']);
  });

  it('keeps a segment whose reading is still queued or in progress', async () => {
    // The store is asked for read and abandoned readings only, so a queued one
    // never reaches the filter, and the segment stays on the list.
    const { store } = memoryStore({ links: [section(), clip()], searchable: true, consumed: [] });

    const view = await materialForClaim(store, {
      conceptId: 'concept-1',
      rung: 'recognise',
      searchedAt: '2026-09-20T09:00:00Z',
    });

    expect(view.absence).toBeNull();
    expect(ids(view.material)).toEqual(['segment-section', 'segment-clip']);
  });

  it('says so when everything linked to the claim has been read', async () => {
    const { store, asked } = memoryStore({
      links: [section(), clip()],
      searchable: true,
      consumed: [readingOf(section()), readingOf(clip())],
    });

    await expect(
      materialForClaim(store, {
        conceptId: 'concept-1',
        rung: 'recognise',
        searchedAt: '2026-09-20T09:00:00Z',
      }),
    ).resolves.toEqual({ material: [], absence: 'all-consumed' });
    // The catalogue's contents do not change what this claim says.
    expect(asked).toEqual(['forClaim:concept-1', 'consumed']);
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
        in(column: string, values: unknown[]) {
          call.filters.push([column, values]);
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
            model: 'claude-haiku-5-5',
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
      model: 'claude-haiku-5-5',
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

  it('gives each row the address queueing it would open at', async () => {
    const { client } = recordingClient({
      catalogue_links: {
        data: [
          {
            basis: 'Works the multiplier through.',
            confidence: 'verified',
            model: null,
            catalogue_segments: {
              id: 'segment-clip',
              ordinal: 3,
              heading: null,
              section_anchor: null,
              t_start_seconds: 724,
              t_end_seconds: 1110,
              text: '…',
              catalogue_items: {
                id: 'item-lecture',
                title: LECTURE.title,
                author: LECTURE.author,
                kind: 'video',
                canonical_url: LECTURE.canonicalUrl,
                duration_seconds: 4800,
              },
            },
          },
        ],
        error: null,
      },
    });

    const rows = await tableMaterialStore(client, 'user-1').forClaim('concept-1');
    expect(rows[0].openUrl).toBe(clip().openUrl);
  });

  it('reads only this account’s finished and abandoned readings at these addresses', async () => {
    const { client, calls } = recordingClient({
      readings: {
        data: [
          {
            open_url: clip().openUrl,
            sources: { catalogue_item_id: 'item-lecture', canonical_url: LECTURE.canonicalUrl },
          },
          // A reading whose source is gone cannot be matched to a work.
          { open_url: section().openUrl, sources: null },
        ],
        error: null,
      },
    });

    const consumed = await tableMaterialStore(client, 'user-1').consumed([
      clip().openUrl,
      clip().openUrl,
      section().openUrl,
    ]);

    expect(calls[0].filters).toEqual([
      ['user_id', 'user-1'],
      ['status', ['read', 'abandoned']],
      ['open_url', [clip().openUrl, section().openUrl]],
    ]);
    expect(consumed).toEqual([readingOf(clip())]);
  });

  it('asks nothing when there are no addresses to look for', async () => {
    const { client, calls } = recordingClient({});
    await expect(tableMaterialStore(client, 'user-1').consumed([])).resolves.toEqual([]);
    expect(calls).toEqual([]);
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
      loadClaimMaterial(client, 'user-1', {
        conceptId: 'concept-1',
        rung: 'recognise',
        searchedAt: null,
      }),
    ).rejects.toThrow('row-level security');
  });
});
