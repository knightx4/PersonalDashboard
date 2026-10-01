import { describe, expect, it } from 'vitest';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { FROM_NEWS, queueNewsStory, type SentStory } from './news';

/**
 * Sending a newsletter story to the reading queue (plan #1368).
 *
 * Against a small in-memory stand-in for the learn tables rather than
 * Postgres, because what is checked here is what queueNewsStory decides: one
 * From News list, one reading per story however often it is sent, pointing at
 * the saved story, with the article as its source when there is an https
 * link. The unique index that backs "one reading per story" is checked in
 * Postgres by tests/news-story-pointers.test.ts; the stand-in enforces it the
 * same way so the race path below can be driven.
 */

type Row = Record<string, unknown>;

function memoryClient({ raceOnce = false }: { raceOnce?: boolean } = {}) {
  const db: Record<string, Row[]> = { tracks: [], readings: [], sources: [] };
  let next = 0;
  let race = raceOnce;

  function from(table: string) {
    const filters: [string, unknown][] = [];
    let order: { column: string; ascending: boolean } | null = null;
    let limit: number | null = null;
    let pending: Row | null = null;

    const matching = () => {
      let rows = db[table].filter((row) => filters.every(([c, v]) => row[c] === v));
      if (order) {
        const { column, ascending } = order;
        rows = [...rows].sort((a, b) =>
          (a[column] as number) < (b[column] as number) === ascending ? -1 : 1,
        );
      }
      return limit === null ? rows : rows.slice(0, limit);
    };

    const write = (row: Row) => {
      if (
        table === 'readings' &&
        row.news_story_id &&
        db.readings.some((r) => r.news_story_id === row.news_story_id)
      ) {
        return { data: null, error: { code: '23505', message: 'duplicate key' } };
      }
      const id = `${table}-${(next += 1)}`;
      db[table].push({ ...row, id, created_at: next });
      return { data: { id }, error: null };
    };

    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => (filters.push([column, value]), builder),
      order: (column: string, options?: { ascending?: boolean }) => (
        (order = { column, ascending: options?.ascending !== false }), builder
      ),
      limit: (n: number) => ((limit = n), builder),
      maybeSingle: async () => ({ data: matching()[0] ?? null, error: null }),
      insert: (row: Row) => ((pending = row), builder),
      single: async () => {
        const row = pending!;
        if (race && table === 'readings') {
          // The other press lands between this one's lookup and its insert.
          race = false;
          write({ ...row, track_id: row.track_id, title: 'the other press' });
        }
        return write(row);
      },
    };
    return builder;
  }

  return { client: { from } as unknown as LearnSupabaseClient, db };
}

const USER = '00000000-0000-4000-8000-000000000001';

const STORY: SentStory = {
  id: 'saved-1',
  headline: '  The quiet return of the tram ',
  link: 'https://example.com/trams',
  senderName: 'Letters From Work',
};

describe('queueNewsStory', () => {
  it('sent twice, leaves one reading on From News pointing at the saved story', async () => {
    const { client, db } = memoryClient();

    const first = await queueNewsStory(client, USER, STORY);
    const second = await queueNewsStory(client, USER, STORY);

    expect(first.created).toBe(true);
    expect(second).toEqual({ ...first, created: false });

    expect(db.tracks).toHaveLength(1);
    expect(db.tracks[0]).toMatchObject({ title: FROM_NEWS, user_id: USER });

    expect(db.readings).toHaveLength(1);
    expect(db.readings[0]).toMatchObject({
      id: first.readingId,
      track_id: db.tracks[0].id,
      news_story_id: 'saved-1',
      title: 'The quiet return of the tram',
      open_url: 'https://example.com/trams',
      locator_confidence: 'unverified',
      locator_basis: 'A story in Letters From Work, sent from News.',
    });
  });

  it('makes the article the source, deduped on its link', async () => {
    const { client, db } = memoryClient();

    await queueNewsStory(client, USER, STORY);
    await queueNewsStory(client, USER, { ...STORY, id: 'saved-2', headline: 'Same link' });

    expect(db.sources).toHaveLength(1);
    expect(db.sources[0]).toMatchObject({
      canonical_url: 'https://example.com/trams',
      kind: 'article',
      access: 'unknown',
    });
    expect(db.readings.map((r) => r.source_id)).toEqual([db.sources[0].id, db.sources[0].id]);
  });

  it('puts a story with no https link on the list with no source and nothing to open', async () => {
    const { client, db } = memoryClient();

    await queueNewsStory(client, USER, { ...STORY, link: 'http://example.com/plain' });
    await queueNewsStory(client, USER, { ...STORY, id: 'saved-2', link: null });

    expect(db.sources).toHaveLength(0);
    expect(db.readings.map((r) => [r.source_id, r.open_url])).toEqual([
      [null, null],
      [null, null],
    ]);
  });

  it('adds later stories to the same list, after the ones already there', async () => {
    const { client, db } = memoryClient();

    await queueNewsStory(client, USER, STORY);
    await queueNewsStory(client, USER, { ...STORY, id: 'saved-2', headline: 'Second' });

    expect(db.tracks).toHaveLength(1);
    expect(db.readings.map((r) => r.position)).toEqual([10, 20]);
  });

  it('returns the reading a simultaneous send wrote rather than failing', async () => {
    const { client, db } = memoryClient({ raceOnce: true });

    const result = await queueNewsStory(client, USER, STORY);

    expect(db.readings).toHaveLength(1);
    expect(result).toEqual({
      trackId: db.tracks[0].id,
      readingId: db.readings[0].id,
      created: false,
    });
  });
});
