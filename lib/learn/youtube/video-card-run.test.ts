import { describe, expect, it, vi } from 'vitest';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import type { CardToWrite, WriteResult } from '@/lib/learn/feed/write-card';
import { settleVideoCards, writeVideoCards } from './video-card-run';
import { WITHDRAWN } from './video-cards';

/**
 * The video card pass over tables held in memory (plan #1067). The fake
 * answers the few PostgREST calls the pass makes and refuses a second card
 * for one stretch as the unique index does, so what is checked is what
 * reaches learn.feed_cards across runs and verdict changes.
 */

type Row = Record<string, unknown>;

function fakeLearn(tables: Record<string, Row[]>) {
  let ids = 0;
  const from = (table: string) => {
    const filters: ((row: Row) => boolean)[] = [];
    let op: 'select' | 'update' | 'insert' = 'select';
    let values: Row = {};
    let single = false;
    const builder = {
      select: () => builder,
      order: () => builder,
      single: () => ((single = true), builder),
      eq: (column: string, value: unknown) => (filters.push((row) => row[column] === value), builder),
      neq: (column: string, value: unknown) => (filters.push((row) => row[column] !== value), builder),
      is: (column: string, value: null) => (filters.push((row) => (row[column] ?? null) === value), builder),
      not: (column: string) => (filters.push((row) => (row[column] ?? null) !== null), builder),
      in: (column: string, list: unknown[]) => (filters.push((row) => list.includes(row[column])), builder),
      update: (next: Row) => ((op = 'update'), (values = next), builder),
      insert: (next: Row) => ((op = 'insert'), (values = next), builder),
      then: (resolve: (value: { data: unknown; error: { code?: string; message: string } | null }) => void) => {
        const rows = (tables[table] ??= []);
        if (op === 'insert') {
          const taken = rows.some(
            (row) =>
              row.user_id === values.user_id &&
              row.video_id === values.video_id &&
              row.video_start_seconds === values.video_start_seconds,
          );
          if (taken) return resolve({ data: null, error: { code: '23505', message: 'feed_cards_video_stretch_uq' } });
          const row = { id: `card-${++ids}`, status: 'picked', drop_reason: null, summary: null, ...values };
          rows.push(row);
          return resolve({ data: single ? { id: row.id } : [{ id: row.id }], error: null });
        }
        const hit = rows.filter((row) => filters.every((filter) => filter(row)));
        if (op === 'update') for (const row of hit) Object.assign(row, values);
        resolve({ data: hit, error: null });
      },
    };
    return builder;
  };
  return { from } as unknown as LearnSupabaseClient;
}

const USER = 'user-1';
const transcript = (from: number, to: number, label: string) => ({
  id: `seg-${from}`,
  item_id: 'item-a',
  t_start_seconds: from,
  t_end_seconds: to,
  text: `${label} `.repeat(80).trim(),
});

function setUp(): Record<string, Row[]> {
  return {
    watch_list: [
      {
        user_id: USER,
        video_id: 'aaaaaaaaaaa',
        item_id: 'item-a',
        verdict: 'card',
        left_playlist_at: null,
        stretches: [
          { startSeconds: 30, endSeconds: 150, point: 'Cash runs out before profit does.' },
          { startSeconds: 400, endSeconds: 520, point: 'Payment terms move cash between firms.' },
          // Past the transcript: nothing to write from yet.
          { startSeconds: 2000, endSeconds: 2100, point: 'A point with no transcript.' },
        ],
        item: { title: 'Cash flow in ten minutes', author: 'A channel', provider: { name: 'Your YouTube list' } },
      },
    ],
    catalogue_segments: [transcript(0, 300, 'cash'), transcript(300, 600, 'terms')],
    feed_cards: [
      // From a video since taken off the pile: one untouched, one saved.
      { id: 'old-1', user_id: USER, reason: 'video', video_id: 'bbbbbbbbbbb', video_start_seconds: 0, status: 'ready', drop_reason: null, summary: 'Why.' },
      { id: 'old-2', user_id: USER, reason: 'video', video_id: 'bbbbbbbbbbb', video_start_seconds: 90, status: 'saved', drop_reason: null, summary: 'Why.' },
    ],
  };
}

/** Stands in for writePickedCard: fills the claimed row as the writer would. */
function writer(tables: Record<string, Row[]>) {
  return vi.fn(async (_userId: string, card: CardToWrite): Promise<WriteResult> => {
    const row = tables.feed_cards!.find((candidate) => candidate.id === card.id)!;
    Object.assign(row, { status: 'ready', idea_name: 'An idea', summary: 'Why it holds.' });
    return { outcome: 'ready', why: 'From a video on your playlist.', ideas: [] };
  });
}

const videoCards = (tables: Record<string, Row[]>) =>
  tables.feed_cards!.filter((row) => row.video_id === 'aaaaaaaaaaa').map((row) => [row.video_start_seconds, row.status]);

describe('writeVideoCards', () => {
  it('writes one card per stretch, once, and sets aside what left the pile', async () => {
    const tables = setUp();
    const learn = fakeLearn(tables);
    const write = writer(tables);

    const first = await writeVideoCards(learn, { deadline: Date.now() + 60_000, write });
    expect(first).toMatchObject({ written: 2, thin: 1, failed: 0, withdrawn: 1, revived: 0 });
    expect(videoCards(tables)).toEqual([
      [30, 'ready'],
      [400, 'ready'],
    ]);

    // What the writer was given: the stretch's transcript, the video, one idea.
    const [, card] = write.mock.calls[0]!;
    expect(card).toMatchObject({
      reason: 'video',
      segmentId: 'seg-0',
      article: 'Cash flow in ten minutes',
      section: '0:30 to 2:30',
      maxIdeas: 1,
      video: { title: 'Cash flow in ten minutes', channel: 'A channel', point: 'Cash runs out before profit does.' },
    });
    const claimed = tables.feed_cards!.find((row) => row.video_start_seconds === 400)!;
    expect(claimed).toMatchObject({ segment_id: 'seg-300', idea_index: 1, video_end_seconds: 520, item_id: 'item-a' });

    // The untouched card from the other video is set aside; the saved one is yours.
    expect(tables.feed_cards!.find((row) => row.id === 'old-1')).toMatchObject({ status: 'dropped', drop_reason: WITHDRAWN });
    expect(tables.feed_cards!.find((row) => row.id === 'old-2')).toMatchObject({ status: 'saved' });

    // A second run writes nothing and pays for nothing.
    const second = await writeVideoCards(learn, { deadline: Date.now() + 60_000, write });
    expect(second).toMatchObject({ written: 0, withdrawn: 0, revived: 0 });
    expect(write).toHaveBeenCalledTimes(2);
    expect(videoCards(tables)).toHaveLength(2);
  });

  it('withdraws the cards when you move the video out of the pile, and brings them back unwritten when it returns', async () => {
    const tables = setUp();
    const learn = fakeLearn(tables);
    const write = writer(tables);
    await writeVideoCards(learn, { deadline: Date.now() + 60_000, write });

    tables.watch_list![0]!.verdict = 'skip';
    const moved = await writeVideoCards(learn, { deadline: Date.now() + 60_000, write });
    expect(moved.withdrawn).toBe(2);
    expect(videoCards(tables)).toEqual([
      [30, 'dropped'],
      [400, 'dropped'],
    ]);

    tables.watch_list![0]!.verdict = 'card';
    const back = await writeVideoCards(learn, { deadline: Date.now() + 60_000, write });
    expect(back).toMatchObject({ revived: 2, written: 0 });
    expect(videoCards(tables)).toEqual([
      [30, 'ready'],
      [400, 'ready'],
    ]);
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('leaves a claimed card to the next run when the writing call fails', async () => {
    const tables = setUp();
    const learn = fakeLearn(tables);
    const failing = vi.fn(async (): Promise<WriteResult> => ({ outcome: 'failed', detail: 'Rate limited.' }));
    const result = await writeVideoCards(learn, { deadline: Date.now() + 60_000, write: failing });
    expect(result.failed).toBe(2);
    expect(videoCards(tables)).toEqual([
      [30, 'picked'],
      [400, 'picked'],
    ]);

    const write = writer(tables);
    const retried = await writeVideoCards(learn, { deadline: Date.now() + 60_000, write });
    expect(retried.written).toBe(2);
    expect(videoCards(tables)).toHaveLength(2);
  });

  it('starts nothing past its deadline', async () => {
    const tables = setUp();
    const write = writer(tables);
    const result = await writeVideoCards(fakeLearn(tables), { deadline: Date.now() - 1, write });
    expect(write).not.toHaveBeenCalled();
    expect(result.stopped).toMatch(/out of time/);
  });
});

describe('settleVideoCards', () => {
  it('sets one person\'s cards aside and back at once, writing nothing and leaving other people\'s alone', async () => {
    const tables = setUp();
    const learn = fakeLearn(tables);
    await writeVideoCards(learn, { deadline: Date.now() + 60_000, write: writer(tables) });
    tables.feed_cards!.push({
      id: 'theirs', user_id: 'user-2', reason: 'video', video_id: 'ccccccccccc', video_start_seconds: 0, status: 'ready', drop_reason: null, summary: 'Why.',
    });

    tables.watch_list![0]!.verdict = 'watch';
    expect(await settleVideoCards(learn, USER)).toEqual({ withdrawn: 2, revived: 0 });
    expect(videoCards(tables)).toEqual([
      [30, 'dropped'],
      [400, 'dropped'],
    ]);
    expect(tables.feed_cards!.find((row) => row.id === 'theirs')).toMatchObject({ status: 'ready' });

    tables.watch_list![0]!.verdict = 'card';
    expect(await settleVideoCards(learn, USER)).toEqual({ withdrawn: 0, revived: 2 });
    expect(videoCards(tables)).toEqual([
      [30, 'ready'],
      [400, 'ready'],
    ]);
  });
});
