import { describe, expect, it } from 'vitest';
import { loadTracks } from './load';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';

/**
 * What a search sends to PostgREST.
 *
 * The narrowing itself is the database's, so the thing worth asserting is the
 * filter the loader hands it: that a search covers both the title and the
 * question, that the wildcards are escaped, and that a box somebody typed
 * nothing into sends no filter at all rather than one matching everything.
 */

type TrackRecord = {
  id: string;
  title: string;
  question: string | null;
  status: string;
  created_at: string;
  branched_from: string | null;
};

const TRACKS: TrackRecord[] = [
  {
    id: 'track-1',
    title: 'Value and price',
    question: 'why does price only report an equilibrium?',
    status: 'active',
    created_at: '2026-02-01T00:00:00Z',
    branched_from: null,
  },
];

/**
 * A stand-in for the session client: enough of the builder for the two reads
 * loadTracks makes, recording every `or` it was given.
 */
function recordingClient(tracks: TrackRecord[] = TRACKS) {
  const filters: string[] = [];

  const tracksRead = {
    or(expression: string) {
      filters.push(expression);
      return tracksRead;
    },
    order: async () => ({ data: tracks, error: null }),
  };

  const client = {
    from(table: string) {
      if (table === 'tracks') return { select: () => tracksRead };
      return {
        select: async () => ({
          data: [
            { track_id: 'track-1', status: 'read' },
            { track_id: 'track-1', status: 'queued' },
          ],
          error: null,
        }),
      };
    },
  };

  return { client: client as unknown as LearnSupabaseClient, filters };
}

describe('loadTracks', () => {
  it('sends no filter without a search, and still counts progress', async () => {
    const { client, filters } = recordingClient();

    const tracks = await loadTracks(client);

    expect(filters).toEqual([]);
    expect(tracks).toHaveLength(1);
    expect(tracks[0].progress).toEqual({
      read: 1,
      remaining: 1,
      abandoned: 0,
      fraction: 0.5,
    });
  });

  it('matches the title or the question, either case', async () => {
    const { client, filters } = recordingClient();

    await loadTracks(client, { search: 'Price' });

    expect(filters).toEqual(['title.ilike.%Price%,question.ilike.%Price%']);
  });

  it('escapes the wildcards, so a typed % is a %', async () => {
    const { client, filters } = recordingClient();

    await loadTracks(client, { search: '50%' });
    await loadTracks(client, { search: 'a_b' });

    expect(filters).toEqual([
      'title.ilike.%50\\%%,question.ilike.%50\\%%',
      'title.ilike.%a\\_b%,question.ilike.%a\\_b%',
    ]);
  });

  it('treats a blank search as no search', async () => {
    const { client, filters } = recordingClient();

    await loadTracks(client, { search: '' });
    await loadTracks(client, { search: '   ' });

    expect(filters).toEqual([]);
  });

  it('trims what was typed', async () => {
    const { client, filters } = recordingClient();

    await loadTracks(client, { search: '  prices  ' });

    expect(filters).toEqual(['title.ilike.%prices%,question.ilike.%prices%']);
  });
});
