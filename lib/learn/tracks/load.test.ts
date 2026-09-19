import { describe, expect, it } from 'vitest';
import { loadTracks } from './load';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';

/**
 * What a search of the tracks list asks the database for.
 *
 * Stubbed rather than run against Postgres: `ilike` is the database's to
 * implement, and what can go wrong here is the filter this file builds. A
 * blank box that narrows the list to nothing and a typed `%` that matches
 * everything are both bugs somebody would hit on their first search.
 */

type Stub = {
  client: LearnSupabaseClient;
  /** The `or` expression the tracks query was given, or null if it was not filtered. */
  filter: () => string | null;
};

function clientWithTracks(
  tracks: Array<{ id: string; title: string; question: string | null }>,
): Stub {
  let filter: string | null = null;

  const rows = tracks.map((track) => ({
    ...track,
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
    branched_from: null,
  }));

  const client = {
    from(table: string) {
      if (table === 'readings') {
        return { select: async () => ({ data: [], error: null }) } as never;
      }
      const builder = {
        or(expression: string) {
          filter = expression;
          return builder;
        },
        order: async () => ({ data: rows, error: null }),
      };
      return { select: () => builder } as never;
    },
  } as unknown as LearnSupabaseClient;

  return { client, filter: () => filter };
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
});
