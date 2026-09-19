import { describe, expect, it } from 'vitest';
import { loadTracks } from './load';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';

/**
 * What a search of the tracks list asks the database for.
 *
 * Stubbed rather than run against Postgres: `ilike` is the database's to
 * implement, and what can go wrong here is the filters this file builds and
 * which reads it makes. A blank box that narrows the list to nothing and a
 * typed `%` that matches everything are both bugs somebody would hit on their
 * first search. The union of the tracks a search found with the tracks its
 * readings found is tested in matches.test.ts.
 */

type TrackRow = { id: string; title: string; question: string | null };

type ReadingRow = {
  id: string;
  track_id: string;
  title: string | null;
  sources: { title: string } | null;
};

type Stub = {
  client: LearnSupabaseClient;
  /** The `or` expression the tracks query was given, or null if it was not filtered. */
  filter: () => string | null;
  /** Every `ilike` the readings were searched with, as column and pattern. */
  readingFilters: () => Array<[string, string]>;
  /** The ids the second tracks read asked for, or null if it was never made. */
  holderIds: () => string[] | null;
};

function asTrackRecord(track: TrackRow, createdAt = '2026-01-01T00:00:00Z') {
  return { ...track, status: 'active', created_at: createdAt, branched_from: null };
}

function clientWithTracks(
  tracks: TrackRow[],
  matches: { byTitle?: ReadingRow[]; bySource?: ReadingRow[]; holders?: TrackRow[] } = {},
): Stub {
  let filter: string | null = null;
  let holderIds: string[] | null = null;
  const readingFilters: Array<[string, string]> = [];

  const client = {
    from(table: string) {
      if (table === 'readings') {
        return {
          select(columns: string) {
            // The progress read, which is awaited as it is.
            if (columns === 'track_id, status') {
              return Promise.resolve({ data: [], error: null });
            }

            const rows = columns.includes('!inner')
              ? (matches.bySource ?? [])
              : (matches.byTitle ?? []);
            const builder = {
              ilike(column: string, pattern: string) {
                readingFilters.push([column, pattern]);
                return builder;
              },
              order: async () => ({ data: rows, error: null }),
            };
            return builder;
          },
        } as never;
      }

      const builder = {
        or(expression: string) {
          filter = expression;
          return builder;
        },
        in(_column: string, ids: string[]) {
          holderIds = ids;
          return Promise.resolve({
            data: (matches.holders ?? []).map((track) => asTrackRecord(track)),
            error: null,
          });
        },
        order: async () => ({ data: tracks.map((track) => asTrackRecord(track)), error: null }),
      };
      return { select: () => builder } as never;
    },
  } as unknown as LearnSupabaseClient;

  return {
    client,
    filter: () => filter,
    readingFilters: () => readingFilters,
    holderIds: () => holderIds,
  };
}

describe('loadTracks', () => {
  const tracks = [{ id: 't1', title: 'Prices', question: 'How do prices coordinate?' }];

  it('matches the title or the question', async () => {
    const stub = clientWithTracks(tracks);
    await loadTracks(stub.client, 'prices');

    expect(stub.filter()).toBe('title.ilike.%prices%,question.ilike.%prices%');
  });

  it('escapes the wildcards, so a typed % is a %', async () => {
    const stub = clientWithTracks(tracks);
    await loadTracks(stub.client, '50% _ done');

    expect(stub.filter()).toBe('title.ilike.%50\\% \\_ done%,question.ilike.%50\\% \\_ done%');
  });

  it('does not filter without a search', async () => {
    const stub = clientWithTracks(tracks);
    const result = await loadTracks(stub.client);

    expect(stub.filter()).toBeNull();
    expect(result).toHaveLength(1);
  });

  it('does not filter on a blank search', async () => {
    const stub = clientWithTracks(tracks);
    const result = await loadTracks(stub.client, '   ');

    expect(stub.filter()).toBeNull();
    expect(result).toHaveLength(1);
  });

  it('trims the search it does use', async () => {
    const stub = clientWithTracks(tracks);
    await loadTracks(stub.client, '  prices  ');

    expect(stub.filter()).toBe('title.ilike.%prices%,question.ilike.%prices%');
  });

  it('still reads progress for the tracks that came back', async () => {
    const stub = clientWithTracks(tracks);
    const result = await loadTracks(stub.client, 'prices');

    expect(result[0].progress).toEqual({ read: 0, remaining: 0, abandoned: 0, fraction: 0 });
  });

  it('searches the readings by their own words and by their source title', async () => {
    const stub = clientWithTracks(tracks);
    await loadTracks(stub.client, 'hayek');

    expect(stub.readingFilters()).toEqual([
      ['title', '%hayek%'],
      ['sources.title', '%hayek%'],
    ]);
  });

  it('leaves the readings alone without a search', async () => {
    const stub = clientWithTracks(tracks);
    const result = await loadTracks(stub.client);

    expect(stub.readingFilters()).toEqual([]);
    expect(stub.holderIds()).toBeNull();
    expect(result[0].matches).toEqual([]);
  });

  it('brings back the track holding a matching reading', async () => {
    const stub = clientWithTracks([], {
      bySource: [
        { id: 'r1', track_id: 't2', title: 'the knowledge one', sources: { title: 'Hayek' } },
      ],
      holders: [{ id: 't2', title: 'Economics', question: null }],
    });

    const result = await loadTracks(stub.client, 'hayek');

    expect(stub.holderIds()).toEqual(['t2']);
    expect(result.map((track) => track.id)).toEqual(['t2']);
    // The source's title, the same name the reading is given everywhere else.
    expect(result[0].matches).toEqual([{ id: 'r1', subject: 'Hayek' }]);
  });

  it('does not re-read a track the search already found', async () => {
    const stub = clientWithTracks(tracks, {
      byTitle: [{ id: 'r1', track_id: 't1', title: 'prices at the margin', sources: null }],
    });

    const result = await loadTracks(stub.client, 'prices');

    expect(stub.holderIds()).toBeNull();
    expect(result).toHaveLength(1);
    expect(result[0].matches).toEqual([{ id: 'r1', subject: 'prices at the margin' }]);
  });

  it('returns nothing when neither the tracks nor their readings match', async () => {
    const stub = clientWithTracks([]);
    const result = await loadTracks(stub.client, 'nothing at all');

    expect(result).toEqual([]);
  });
});
