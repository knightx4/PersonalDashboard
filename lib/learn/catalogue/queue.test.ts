import { describe, expect, it } from 'vitest';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import type { LinkTarget } from '@/lib/learn/catalogue/judge';
import {
  clipLabel,
  locatorFor,
  queueSegment,
  tableQueueStore,
  type NewReading,
  type NewSource,
  type QueueStore,
  type QueueableSegment,
  type SegmentLink,
} from '@/lib/learn/catalogue/queue';

/**
 * What queueing promises.
 *
 * The step's own acceptance is three of these: a video segment queues as a
 * reading that reads `12:04-18:30` and opens at that minute, an article
 * section opens at that section, and two segments of one lecture leave one
 * source row with two readings. The third is the one with something to get
 * wrong, so the source dedupe is tested from all three directions it can be
 * reached from: the catalogue item, a source already held at that URL, and an
 * insert that lost a race.
 *
 * No database, as everywhere else in this directory. The pass runs against a
 * store in memory, and the live store is checked against a client that records
 * the statements it was handed.
 */

const CLAIM: LinkTarget = { concept: 'concept-1' };

const LECTURE = {
  id: 'item-lecture',
  title: 'Lecture 7: Money and Banking',
  author: 'MIT OpenCourseWare',
  kind: 'video',
  canonicalUrl: 'https://www.youtube.com/watch?v=abc123',
  durationSeconds: 4800,
  publishedAt: '2019-09-04',
};

const ARTICLE = {
  id: 'item-article',
  title: 'Fractional-reserve banking',
  author: null,
  kind: 'article',
  canonicalUrl: 'https://en.wikipedia.org/wiki/Fractional-reserve_banking',
  durationSeconds: null,
  publishedAt: null,
};

function clip(overrides: Partial<QueueableSegment> = {}): QueueableSegment {
  return {
    segmentId: 'segment-clip',
    ordinal: 3,
    heading: null,
    sectionAnchor: null,
    tStartSeconds: 724,
    tEndSeconds: 1110,
    item: LECTURE,
    ...overrides,
  };
}

function section(overrides: Partial<QueueableSegment> = {}): QueueableSegment {
  return {
    segmentId: 'segment-section',
    ordinal: 2,
    heading: 'Money creation',
    sectionAnchor: 'Money_creation',
    tStartSeconds: null,
    tEndSeconds: null,
    item: ARTICLE,
    ...overrides,
  };
}

type MemoryOptions = {
  segments: QueueableSegment[];
  links?: Record<string, SegmentLink>;
  sources?: { id: string; canonicalUrl: string; catalogueItemId: string | null }[];
  /** The next insert loses to another press, which wrote this source. */
  raceWinner?: { id: string; canonicalUrl: string; catalogueItemId: string | null };
};

function memoryStore(options: MemoryOptions) {
  const sources = [...(options.sources ?? [])];
  const readings: (NewReading & { id: string })[] = [];
  const written: NewSource[] = [];
  let raced = options.raceWinner;
  let next = 0;

  const store: QueueStore = {
    async segment(segmentId) {
      return options.segments.find((row) => row.segmentId === segmentId) ?? null;
    },
    async link({ segmentId }) {
      return options.links?.[segmentId] ?? null;
    },
    async sourceForItem(itemId) {
      return sources.find((row) => row.catalogueItemId === itemId)?.id ?? null;
    },
    async sourceForUrl(url) {
      const found = sources.find((row) => row.canonicalUrl === url);
      return found ? { id: found.id, catalogueItemId: found.catalogueItemId } : null;
    },
    async adopt({ sourceId, itemId }) {
      const found = sources.find((row) => row.id === sourceId);
      if (found) found.catalogueItemId = itemId;
    },
    async createSource(source) {
      written.push(source);
      if (raced) {
        // The unique index on (user_id, canonical_url) refused this one.
        sources.push(raced);
        raced = undefined;
        return null;
      }
      next += 1;
      const id = `source-${next}`;
      sources.push({ id, canonicalUrl: source.canonicalUrl, catalogueItemId: source.catalogueItemId });
      return id;
    },
    async readingAt({ sourceId, openUrl }) {
      return readings.find((row) => row.sourceId === sourceId && row.locator.openUrl === openUrl)?.id ?? null;
    },
    async lastPosition() {
      return readings.length === 0 ? 0 : Math.max(...readings.map((row) => row.position));
    },
    async createReading(reading) {
      const id = `reading-${readings.length + 1}`;
      readings.push({ ...reading, id });
      return id;
    },
  };

  return { store, sources, readings, written };
}

describe('where a queued segment points', () => {
  it('renders a clip as the minutes it covers', () => {
    expect(clipLabel(724, 1110)).toBe('12:04–18:30');
  });

  it('keeps the hour when a work is long enough to have one', () => {
    expect(clipLabel(3903, 4000)).toBe('1:05:03–1:06:40');
  });

  it('says where an open-ended clip starts rather than inventing an end', () => {
    expect(clipLabel(724, null)).toBe('From 12:04');
  });

  it('treats a clip from the first second as a clip', () => {
    const locator = locatorFor(clip({ tStartSeconds: 0, tEndSeconds: 240 }));

    expect(locator.locatorKind).toBe('timestamp');
    expect(locator.tStartSeconds).toBe(0);
    expect(locator.locatorLabel).toBe('0:00–4:00');
  });

  it('puts the second in the query for a video the host takes it from', () => {
    expect(locatorFor(clip()).openUrl).toBe('https://www.youtube.com/watch?v=abc123&t=724');
  });

  it('falls back to the media fragment for anything else', () => {
    const elsewhere = clip({
      item: { ...LECTURE, canonicalUrl: 'https://ocw.mit.edu/lectures/7.mp4' },
    });

    expect(locatorFor(elsewhere).openUrl).toBe('https://ocw.mit.edu/lectures/7.mp4#t=724,1110');
  });

  it('opens an article at its section, labelled with the heading', () => {
    const locator = locatorFor(section());

    expect(locator.locatorKind).toBe('section');
    expect(locator.locatorLabel).toBe('Money creation');
    expect(locator.tStartSeconds).toBeNull();
    expect(locator.openUrl).toBe(
      'https://en.wikipedia.org/wiki/Fractional-reserve_banking#Money_creation',
    );
  });

  it('opens the work itself when the segment stands for the whole of it', () => {
    const whole = clip({ tStartSeconds: null, tEndSeconds: null });
    const locator = locatorFor(whole);

    expect(locator.locatorKind).toBe('whole');
    expect(locator.locatorLabel).toBeNull();
    expect(locator.openUrl).toBe(LECTURE.canonicalUrl);
  });
});

describe('queueing a segment', () => {
  it('writes a reading that reads 12:04-18:30 and opens there', async () => {
    const { store, readings, written } = memoryStore({
      segments: [clip()],
      links: { 'segment-clip': { basis: 'Works the deposit multiplier through.', confidence: 'verified' } },
    });

    const queued = await queueSegment(store, {
      segmentId: 'segment-clip',
      trackId: 'track-1',
      target: CLAIM,
    });

    expect(queued.created).toBe(true);
    expect(readings).toHaveLength(1);
    expect(readings[0].locator).toMatchObject({
      locatorKind: 'timestamp',
      locatorLabel: '12:04–18:30',
      tStartSeconds: 724,
      tEndSeconds: 1110,
      openUrl: 'https://www.youtube.com/watch?v=abc123&t=724',
    });
    expect(readings[0].conceptId).toBe('concept-1');
    expect(readings[0].why).toBe('Works the deposit multiplier through.');

    // The work's own URL, never the clip: the unique index on the source URL
    // is what makes two clips of one lecture one source.
    expect(written[0].canonicalUrl).toBe(LECTURE.canonicalUrl);
    expect(written[0].catalogueItemId).toBe('item-lecture');
    expect(written[0].year).toBe(2019);
  });

  it('writes a reading that opens at the section of an article', async () => {
    const { store, readings } = memoryStore({ segments: [section()] });

    await queueSegment(store, { segmentId: 'segment-section', trackId: 'track-1', target: CLAIM });

    expect(readings[0].locator.openUrl).toBe(
      'https://en.wikipedia.org/wiki/Fractional-reserve_banking#Money_creation',
    );
    expect(readings[0].locator.locatorLabel).toBe('Money creation');
  });

  it('leaves one source and two readings for two segments of one lecture', async () => {
    const second = clip({ segmentId: 'segment-clip-2', ordinal: 8, tStartSeconds: 2400, tEndSeconds: 2700 });
    const { store, sources, readings, written } = memoryStore({ segments: [clip(), second] });

    const first = await queueSegment(store, { segmentId: 'segment-clip', trackId: 'track-1', target: CLAIM });
    const next = await queueSegment(store, { segmentId: 'segment-clip-2', trackId: 'track-1', target: CLAIM });

    expect(sources).toHaveLength(1);
    expect(written).toHaveLength(1);
    expect(next.sourceId).toBe(first.sourceId);

    expect(readings).toHaveLength(2);
    expect(readings.map((row) => row.locator.locatorLabel)).toEqual(['12:04–18:30', '40:00–45:00']);
    // Appended rather than written over each other.
    expect(readings[1].position).toBeGreaterThan(readings[0].position);
  });

  it('hands back the reading already queued rather than a second copy', async () => {
    const { store, readings } = memoryStore({ segments: [clip()] });

    const first = await queueSegment(store, { segmentId: 'segment-clip', trackId: 'track-1', target: CLAIM });
    const again = await queueSegment(store, { segmentId: 'segment-clip', trackId: 'track-1', target: CLAIM });

    expect(again).toEqual({ readingId: first.readingId, sourceId: first.sourceId, created: false });
    expect(readings).toHaveLength(1);
  });

  it('adopts a source you already had at that URL instead of duplicating it', async () => {
    const { store, sources, written } = memoryStore({
      segments: [section()],
      sources: [{ id: 'source-pasted', canonicalUrl: ARTICLE.canonicalUrl, catalogueItemId: null }],
    });

    const queued = await queueSegment(store, {
      segmentId: 'segment-section',
      trackId: 'track-1',
      target: CLAIM,
    });

    expect(queued.sourceId).toBe('source-pasted');
    expect(written).toEqual([]);
    // And it now knows where it came from, so the next press takes the first
    // branch rather than matching on the URL again.
    expect(sources[0].catalogueItemId).toBe('item-article');
  });

  it('reads back the source that won when the insert lost a race', async () => {
    const { store, readings } = memoryStore({
      segments: [clip()],
      raceWinner: { id: 'source-winner', canonicalUrl: LECTURE.canonicalUrl, catalogueItemId: 'item-lecture' },
    });

    const queued = await queueSegment(store, {
      segmentId: 'segment-clip',
      trackId: 'track-1',
      target: CLAIM,
    });

    expect(queued.sourceId).toBe('source-winner');
    expect(readings[0].sourceId).toBe('source-winner');
  });

  it('says the match was judged when a model argued for it', async () => {
    const { store, readings } = memoryStore({
      segments: [section()],
      links: { 'segment-section': { basis: 'Derives the multiplier.', confidence: 'verified' } },
    });

    await queueSegment(store, { segmentId: 'segment-section', trackId: 'track-1', target: CLAIM });

    expect(readings[0].locatorBasis).toContain('argued');
    expect(readings[0].locatorBasis).not.toContain('nearest');
  });

  it('says nothing has checked it when there is no judged link behind the press', async () => {
    const { store, readings } = memoryStore({ segments: [section()] });

    await queueSegment(store, { segmentId: 'segment-section', trackId: 'track-1', target: CLAIM });

    expect(readings[0].why).toBeNull();
    expect(readings[0].locatorBasis).toContain('nearest');
  });

  it('refuses a segment that is not in the catalogue', async () => {
    const { store } = memoryStore({ segments: [] });

    await expect(
      queueSegment(store, { segmentId: 'segment-gone', trackId: 'track-1', target: CLAIM }),
    ).rejects.toThrow('not in the catalogue');
  });
});

type Reply = { data: unknown; error: { code?: string; message: string } | null };

/** A client that records the statements it was handed. */
function recordingClient(replies: Record<string, Reply>) {
  const calls: { table: string; op: string; filters: [string, unknown][]; row?: unknown }[] = [];

  const client = {
    from(table: string) {
      const call = { table, op: 'select', filters: [] as [string, unknown][], row: undefined as unknown };
      const answer = () => {
        calls.push(call);
        return Promise.resolve(replies[`${call.table}.${call.op}`] ?? { data: null, error: null });
      };

      const builder = {
        select: () => builder,
        insert(row: unknown) {
          call.op = 'insert';
          call.row = row;
          return builder;
        },
        update(row: unknown) {
          call.op = 'update';
          call.row = row;
          return builder;
        },
        eq(column: string, value: unknown) {
          call.filters.push([column, value]);
          return builder;
        },
        in(column: string, value: unknown) {
          call.filters.push([column, value]);
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        single: answer,
        maybeSingle: answer,
        // What an update is awaited as, having no row to hand back.
        then: (resolve: (value: Reply) => unknown, reject?: (reason: unknown) => unknown) =>
          answer().then(resolve, reject),
      };

      return builder;
    },
  };

  return { client: client as unknown as LearnSupabaseClient, calls };
}

describe('the live store', () => {
  it('flattens the work PostgREST embedded beside the segment', async () => {
    const { client } = recordingClient({
      'catalogue_segments.select': {
        data: {
          id: 'segment-clip',
          ordinal: 3,
          heading: null,
          section_anchor: null,
          t_start_seconds: 724,
          t_end_seconds: 1110,
          // An array, which is the shape PostgREST sometimes answers with.
          catalogue_items: [
            {
              id: 'item-lecture',
              title: LECTURE.title,
              author: LECTURE.author,
              kind: 'video',
              canonical_url: LECTURE.canonicalUrl,
              duration_seconds: 4800,
              published_at: '2019-09-04',
            },
          ],
        },
        error: null,
      },
    });

    const segment = await tableQueueStore(client, 'user-1').segment('segment-clip');

    expect(segment?.item).toEqual({
      id: 'item-lecture',
      title: LECTURE.title,
      author: LECTURE.author,
      kind: 'video',
      canonicalUrl: LECTURE.canonicalUrl,
      durationSeconds: 4800,
      publishedAt: '2019-09-04',
    });
    expect(segment?.tStartSeconds).toBe(724);
  });

  it('materialises the source pointed at its catalogue item', async () => {
    const { client, calls } = recordingClient({
      'sources.insert': { data: { id: 'source-1' }, error: null },
    });

    await expect(
      tableQueueStore(client, 'user-1').createSource({
        catalogueItemId: 'item-lecture',
        title: LECTURE.title,
        author: LECTURE.author,
        kind: 'video',
        year: 2019,
        canonicalUrl: LECTURE.canonicalUrl,
        durationSeconds: 4800,
      }),
    ).resolves.toBe('source-1');

    expect(calls[0].row).toEqual({
      user_id: 'user-1',
      catalogue_item_id: 'item-lecture',
      title: LECTURE.title,
      author: LECTURE.author,
      kind: 'video',
      year: 2019,
      canonical_url: LECTURE.canonicalUrl,
      duration_seconds: 4800,
      access: 'open',
    });
  });

  it('reads a unique violation on the source as another press having written it', async () => {
    const { client } = recordingClient({
      'sources.insert': {
        data: null,
        error: { code: '23505', message: 'duplicate key value violates unique constraint' },
      },
    });

    await expect(
      tableQueueStore(client, 'user-1').createSource({
        catalogueItemId: 'item-lecture',
        title: LECTURE.title,
        author: null,
        kind: 'video',
        year: null,
        canonicalUrl: LECTURE.canonicalUrl,
        durationSeconds: null,
      }),
    ).resolves.toBeNull();
  });

  it('raises anything else the source insert said', async () => {
    const { client } = recordingClient({
      'sources.insert': {
        data: null,
        error: { code: '42501', message: 'new row violates row-level security policy' },
      },
    });

    await expect(
      tableQueueStore(client, 'user-1').createSource({
        catalogueItemId: 'item-lecture',
        title: LECTURE.title,
        author: null,
        kind: 'video',
        year: null,
        canonicalUrl: LECTURE.canonicalUrl,
        durationSeconds: null,
      }),
    ).rejects.toThrow('row-level security');
  });

  it('writes the offsets and the label on the reading, at verified', async () => {
    const { client, calls } = recordingClient({
      'readings.insert': { data: { id: 'reading-1' }, error: null },
    });

    await tableQueueStore(client, 'user-1').createReading({
      trackId: 'track-1',
      sourceId: 'source-1',
      conceptId: 'concept-1',
      position: 20,
      locator: locatorFor(clip()),
      why: 'Works the deposit multiplier through.',
      locatorBasis: 'A model read this part of the work and argued for it.',
    });

    expect(calls[0].row).toMatchObject({
      user_id: 'user-1',
      track_id: 'track-1',
      source_id: 'source-1',
      concept_id: 'concept-1',
      locator_kind: 'timestamp',
      locator_label: '12:04–18:30',
      t_start_seconds: 724,
      t_end_seconds: 1110,
      open_url: 'https://www.youtube.com/watch?v=abc123&t=724',
      locator_confidence: 'verified',
      why: 'Works the deposit multiplier through.',
    });
  });

  it('looks for an unfinished reading at exactly that place', async () => {
    const { client, calls } = recordingClient({
      'readings.select': { data: { id: 'reading-1' }, error: null },
    });

    await expect(
      tableQueueStore(client, 'user-1').readingAt({
        sourceId: 'source-1',
        openUrl: 'https://www.youtube.com/watch?v=abc123&t=724',
      }),
    ).resolves.toBe('reading-1');

    expect(calls[0].filters).toEqual([
      ['source_id', 'source-1'],
      ['open_url', 'https://www.youtube.com/watch?v=abc123&t=724'],
      ['status', ['queued', 'reading']],
    ]);
  });

  it('asks the catalogue item before the URL', async () => {
    const { client, calls } = recordingClient({
      'sources.select': { data: null, error: null },
    });

    const store = tableQueueStore(client, 'user-1');
    await store.sourceForItem('item-lecture');
    await store.sourceForUrl(LECTURE.canonicalUrl);

    expect(calls.map((call) => call.filters)).toEqual([
      [['catalogue_item_id', 'item-lecture']],
      [['canonical_url', LECTURE.canonicalUrl]],
    ]);
  });
});
