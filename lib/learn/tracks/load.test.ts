import { describe, expect, it } from 'vitest';
import { loadTracks } from './load';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';

/**
 * What a search of the tracks list asks the database for, and which tracks it
 * keeps.
 *
 * Stubbed rather than run against Postgres: the tracks now come back whole and
 * are matched here, so the matching itself is testable without one, and what
 * is left for the database -- `ilike` over the readings -- is its own to
 * implement. A blank box that narrows the list to nothing, a typed `%` that
 * matches everything and a comma that fails the page are all bugs somebody
 * would hit on their first search. The union of the tracks a search found with
 * the tracks its readings found is tested in matches.test.ts.
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
  let trackReads = 0;

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

      trackReads += 1;
      const tracksRead = {
        // Kept on the stub although nothing should call it: an `or` expression
        // is what a comma in the search used to break, so a filter sent to the
        // tracks read has to show up in the assertions rather than pass.
        or(expression: string) {
          filters.push(expression);
          return tracksRead;
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
    /** How many reads of the tracks table were made. */
    trackReads: () => trackReads,
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
    const stub = recordingClient([
      ...TRACKS,
      { id: 'track-2', title: 'Wage labour', question: null },
    ]);

    const byTitle = await loadTracks(stub.client, { search: 'VALUE' });
    const byQuestion = await loadTracks(stub.client, { search: 'coordinate' });

    expect(byTitle.map((track) => track.id)).toEqual(['track-1']);
    expect(byQuestion.map((track) => track.id)).toEqual(['track-1']);
    // Nothing narrowed the query, which is what a comma in the search broke.
    expect(stub.filters).toEqual([]);
  });

  it('matches a phrase with a comma in it', async () => {
    const stub = recordingClient([
      { id: 'track-1', title: 'Value, price and profit', question: null },
      { id: 'track-2', title: 'Wage labour', question: null },
    ]);

    const tracks = await loadTracks(stub.client, { search: 'value, price' });

    expect(tracks.map((track) => track.id)).toEqual(['track-1']);
    expect(stub.filters).toEqual([]);
  });

  it('takes a typed % or _ as the character it is', async () => {
    const stub = recordingClient([
      { id: 'track-1', title: '50% read', question: null },
      { id: 'track-2', title: 'a_b', question: null },
      { id: 'track-3', title: 'neither', question: null },
    ]);

    const percent = await loadTracks(stub.client, { search: '50%' });
    const underscore = await loadTracks(stub.client, { search: 'a_b' });

    expect(percent.map((track) => track.id)).toEqual(['track-1']);
    expect(underscore.map((track) => track.id)).toEqual(['track-2']);
    // The readings are still matched by the database, so their pattern is
    // escaped before it goes out.
    expect(stub.readingFilters).toEqual([
      ['title', '%50\\%%'],
      ['sources.title', '%50\\%%'],
      ['title', '%a\\_b%'],
      ['sources.title', '%a\\_b%'],
    ]);
  });

  it('treats a blank search as no search', async () => {
    const stub = recordingClient();

    const empty = await loadTracks(stub.client, { search: '' });
    const spaces = await loadTracks(stub.client, { search: '   ' });

    expect(stub.readingFilters).toEqual([]);
    expect(empty).toHaveLength(1);
    expect(spaces).toHaveLength(1);
  });

  it('trims what was typed', async () => {
    const stub = recordingClient();

    const tracks = await loadTracks(stub.client, { search: '  prices  ' });

    expect(tracks.map((track) => track.id)).toEqual(['track-1']);
    expect(stub.readingFilters).toEqual([
      ['title', '%prices%'],
      ['sources.title', '%prices%'],
    ]);
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
    expect(tracks[0].matches).toEqual([]);
  });

  it('brings back the track holding a matching reading', async () => {
    const stub = recordingClient(
      [...TRACKS, { id: 'track-2', title: 'Economics', question: null }],
      {
        bySource: [
          {
            id: 'r1',
            track_id: 'track-2',
            title: 'the knowledge one',
            sources: { title: 'Hayek' },
          },
        ],
      },
    );

    const tracks = await loadTracks(stub.client, { search: 'hayek' });

    expect(tracks.map((track) => track.id)).toEqual(['track-2']);
    // The source's title, the same name the reading is given everywhere else.
    expect(tracks[0].matches).toEqual([{ id: 'r1', subject: 'Hayek' }]);
    // One read of the tracks, not a second for the track that reading is in.
    expect(stub.trackReads()).toBe(1);
  });

  it('lists a track once when it and one of its readings match', async () => {
    const stub = recordingClient(TRACKS, {
      byTitle: [{ id: 'r1', track_id: 'track-1', title: 'prices at the margin', sources: null }],
    });

    const tracks = await loadTracks(stub.client, { search: 'prices' });

    expect(tracks).toHaveLength(1);
    expect(tracks[0].matches).toEqual([{ id: 'r1', subject: 'prices at the margin' }]);
    expect(stub.trackReads()).toBe(1);
  });

  it('returns nothing when neither the tracks nor their readings match', async () => {
    const stub = recordingClient();

    const tracks = await loadTracks(stub.client, { search: 'nothing at all' });

    expect(tracks).toEqual([]);
  });
});
