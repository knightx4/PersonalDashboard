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

type ReadingMatchRow = {
  id: string;
  track_id: string;
  title: string | null;
  sources: { title: string } | null;
};

type StatusRow = { track_id: string; status: string };

type Rows = {
  /** Readings whose own words matched. */
  byTitle?: ReadingMatchRow[];
  /** Readings whose source title matched. */
  bySource?: ReadingMatchRow[];
  /** What the read-by-id for the tracks those readings sit in comes back with. */
  holders?: TrackRow[];
  statuses?: StatusRow[];
};

const TRACKS: TrackRow[] = [
  { id: 'track-1', title: 'Value and price', question: 'how do prices coordinate?' },
];

function asTrackRecord(track: TrackRow, createdAt = '2026-02-01T00:00:00Z') {
  return { ...track, status: 'active', created_at: createdAt, branched_from: null };
}

/**
 * A stand-in for the session client: enough of the builder for the reads
 * loadTracks makes, recording every filter it was given.
 */
function recordingClient(tracks: TrackRow[] = TRACKS, rows: Rows = {}) {
  const filters: string[] = [];
  const readingFilters: Array<[string, string]> = [];
  let holders: string[] | null = null;

  const client = {
    from(table: string) {
      if (table === 'readings') {
        return {
          select(columns: string) {
            // The progress read, which is awaited as it is.
            if (columns === 'track_id, status') {
              return Promise.resolve({ data: rows.statuses ?? [], error: null });
            }

            const matched = columns.includes('!inner')
              ? (rows.bySource ?? [])
              : (rows.byTitle ?? []);
            const readingsRead = {
              ilike(column: string, pattern: string) {
                readingFilters.push([column, pattern]);
                return readingsRead;
              },
              order: async () => ({ data: matched, error: null }),
            };
            return readingsRead;
          },
        } as never;
      }

      const tracksRead = {
        or(expression: string) {
          filters.push(expression);
          return tracksRead;
        },
        in(_column: string, ids: string[]) {
          holders = ids;
          return Promise.resolve({
            data: (rows.holders ?? []).map((track) => asTrackRecord(track)),
            error: null,
          });
        },
        order: async () => ({ data: tracks.map((track) => asTrackRecord(track)), error: null }),
      };
      return { select: () => tracksRead } as never;
    },
  };

  return {
    client: client as unknown as LearnSupabaseClient,
    filters,
    readingFilters,
    /** The ids the second tracks read asked for, or null if it was never made. */
    holderIds: () => holders,
  };
}

describe('loadTracks', () => {
  it('sends no filter without a search, and still counts progress', async () => {
    const stub = recordingClient(TRACKS, {
      statuses: [
        { track_id: 'track-1', status: 'read' },
        { track_id: 'track-1', status: 'queued' },
      ],
    });

    const tracks = await loadTracks(stub.client);

    expect(stub.filters).toEqual([]);
    expect(tracks).toHaveLength(1);
    expect(tracks[0].progress).toEqual({ read: 1, remaining: 1, abandoned: 0, fraction: 0.5 });
  });

  it('matches the title or the question, either case', async () => {
    const stub = recordingClient();

    await loadTracks(stub.client, { search: 'Price' });

    expect(stub.filters).toEqual(['title.ilike.%Price%,question.ilike.%Price%']);
  });

  it('escapes the wildcards, so a typed % is a %', async () => {
    const stub = recordingClient();

    await loadTracks(stub.client, { search: '50%' });
    await loadTracks(stub.client, { search: 'a_b' });
    await loadTracks(stub.client, { search: '50% _ done' });

    expect(stub.filters).toEqual([
      'title.ilike.%50\\%%,question.ilike.%50\\%%',
      'title.ilike.%a\\_b%,question.ilike.%a\\_b%',
      'title.ilike.%50\\% \\_ done%,question.ilike.%50\\% \\_ done%',
    ]);
  });

  it('treats a blank search as no search', async () => {
    const stub = recordingClient();

    const empty = await loadTracks(stub.client, { search: '' });
    const spaces = await loadTracks(stub.client, { search: '   ' });

    expect(stub.filters).toEqual([]);
    expect(empty).toHaveLength(1);
    expect(spaces).toHaveLength(1);
  });

  it('trims what was typed', async () => {
    const stub = recordingClient();

    await loadTracks(stub.client, { search: '  prices  ' });

    expect(stub.filters).toEqual(['title.ilike.%prices%,question.ilike.%prices%']);
  });

  it('searches the readings by their own words and by their source title', async () => {
    const stub = recordingClient();

    await loadTracks(stub.client, { search: 'hayek' });

    expect(stub.readingFilters).toEqual([
      ['title', '%hayek%'],
      ['sources.title', '%hayek%'],
    ]);
  });

  it('leaves the readings alone without a search', async () => {
    const stub = recordingClient();

    const tracks = await loadTracks(stub.client);

    expect(stub.readingFilters).toEqual([]);
    expect(stub.holderIds()).toBeNull();
    expect(tracks[0].matches).toEqual([]);
  });

  it('brings back the track holding a matching reading', async () => {
    const stub = recordingClient([], {
      bySource: [
        { id: 'r1', track_id: 'track-2', title: 'the knowledge one', sources: { title: 'Hayek' } },
      ],
      holders: [{ id: 'track-2', title: 'Economics', question: null }],
    });

    const tracks = await loadTracks(stub.client, { search: 'hayek' });

    expect(stub.holderIds()).toEqual(['track-2']);
    expect(tracks.map((track) => track.id)).toEqual(['track-2']);
    // The source's title, the same name the reading is given everywhere else.
    expect(tracks[0].matches).toEqual([{ id: 'r1', subject: 'Hayek' }]);
  });

  it('does not re-read a track the search already found', async () => {
    const stub = recordingClient(TRACKS, {
      byTitle: [{ id: 'r1', track_id: 'track-1', title: 'prices at the margin', sources: null }],
    });

    const tracks = await loadTracks(stub.client, { search: 'prices' });

    expect(stub.holderIds()).toBeNull();
    expect(tracks).toHaveLength(1);
    expect(tracks[0].matches).toEqual([{ id: 'r1', subject: 'prices at the margin' }]);
  });

  it('returns nothing when neither the tracks nor their readings match', async () => {
    const stub = recordingClient([]);

    const tracks = await loadTracks(stub.client, { search: 'nothing at all' });

    expect(tracks).toEqual([]);
  });
});
