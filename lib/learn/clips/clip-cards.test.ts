import { describe, expect, it, vi } from 'vitest';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import type { CardToWrite, WriteResult } from '@/lib/learn/feed/write-card';
import { writeClipCards } from './clip-card-run';
import { clipPoint, clipText, freeIdeaIndex, homeSegment, planClipCards, type SavedClip } from './clip-cards';

/**
 * A saved clip becoming a Learn now card (plan #1405): the pure choices, and
 * the pass over tables held in memory, so what is checked is what reaches
 * learn.feed_cards across runs.
 */

const clip = (over: Partial<SavedClip> = {}): SavedClip => ({
  id: 'clip-1',
  userId: 'user-1',
  videoId: 'aaaaaaaaaaa',
  itemId: 'item-a',
  startSeconds: 320,
  endSeconds: 380,
  caption: 'Why cash runs out first',
  idea: 'A profitable firm can still run out of cash.',
  ...over,
});

const words = (label: string) => `${label} `.repeat(30).trim();

describe('clipText', () => {
  const cues = [
    { startSeconds: 300, endSeconds: 318, text: words('before') },
    { startSeconds: 318, endSeconds: 340, text: words('opening') },
    { startSeconds: 340, endSeconds: null, text: words('middle') },
    { startSeconds: 360, endSeconds: 385, text: words('closing') },
    { startSeconds: 385, endSeconds: 400, text: words('after') },
  ];

  it('takes the lines said during the clip, and none outside it', () => {
    const text = clipText(cues, clip())!;
    expect(text).toContain('opening');
    expect(text).toContain('middle');
    expect(text).toContain('closing');
    expect(text).not.toContain('before');
    expect(text).not.toContain('after');
  });

  it('gives null when the clip holds too few words', () => {
    expect(clipText([{ startSeconds: 330, endSeconds: 335, text: 'Just a caption.' }], clip())).toBeNull();
  });
});

describe('homeSegment', () => {
  const segments = [
    { id: 'b', start: 270, end: 540 },
    { id: 'a', start: 0, end: 270 },
    { id: 'chapters', start: null, end: null },
  ];
  it('is the segment the clip starts in', () => {
    expect(homeSegment(segments, 320)).toBe('b');
    expect(homeSegment(segments, 10)).toBe('a');
  });
  it('is null for a video with no timed segments', () => {
    expect(homeSegment([{ id: 'c', start: null, end: null }], 10)).toBeNull();
  });
});

describe('freeIdeaIndex', () => {
  it('takes the highest free index, leaving the low ones for sections and stretches', () => {
    expect(freeIdeaIndex(new Set([0, 1]))).toBe(9);
    expect(freeIdeaIndex(new Set([9, 8]))).toBe(7);
    expect(freeIdeaIndex(new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]))).toBeNull();
  });
});

describe('planClipCards', () => {
  it('writes a clip with no card, rewrites one still picked, and leaves a written one', () => {
    const saved = [clip({ id: 'new' }), clip({ id: 'picked', startSeconds: 10 }), clip({ id: 'done', startSeconds: 20 })];
    const stored = [
      { id: 'c1', userId: 'user-1', videoId: 'aaaaaaaaaaa', startSeconds: 10, clipId: 'picked', status: 'picked' },
      { id: 'c2', userId: 'user-1', videoId: 'aaaaaaaaaaa', startSeconds: 20, clipId: 'done', status: 'ready' },
    ];
    expect(planClipCards(saved, stored)).toEqual([{ clip: saved[0] }, { clip: saved[1], cardId: 'c1' }]);
  });

  it('gives no second card to a clip starting where a card-pile stretch already does', () => {
    const stored = [{ id: 's', userId: 'user-1', videoId: 'aaaaaaaaaaa', startSeconds: 320, clipId: null, status: 'ready' }];
    expect(planClipCards([clip()], stored)).toEqual([]);
  });
});

describe('clipPoint', () => {
  it('is the idea, or the caption where there is none', () => {
    expect(clipPoint(clip())).toBe('A profitable firm can still run out of cash.');
    expect(clipPoint(clip({ idea: '  ' }))).toBe('Why cash runs out first');
  });
});

type Row = Record<string, unknown>;

function fakeLearn(tables: Record<string, Row[]>) {
  let ids = 0;
  const from = (table: string) => {
    const filters: ((row: Row) => boolean)[] = [];
    let op: 'select' | 'insert' = 'select';
    let values: Row = {};
    let single = false;
    const builder = {
      select: () => builder,
      order: () => builder,
      single: () => ((single = true), builder),
      maybeSingle: () => ((single = true), builder),
      eq: (column: string, value: unknown) => (filters.push((row) => row[column] === value), builder),
      is: (column: string, value: null) => (filters.push((row) => (row[column] ?? null) === value), builder),
      not: (column: string) => (filters.push((row) => (row[column] ?? null) !== null), builder),
      in: (column: string, list: unknown[]) => (filters.push((row) => list.includes(row[column])), builder),
      insert: (next: Row) => ((op = 'insert'), (values = next), builder),
      then: (resolve: (value: { data: unknown; error: { code?: string; message: string } | null }) => void) => {
        const rows = (tables[table] ??= []);
        if (op === 'insert') {
          const taken = rows.some(
            (row) =>
              row.user_id === values.user_id &&
              ((row.segment_id === values.segment_id && row.idea_index === values.idea_index) ||
                (row.clip_id !== undefined && row.clip_id === values.clip_id)),
          );
          if (taken) return resolve({ data: null, error: { code: '23505', message: 'taken' } });
          const row = { id: `card-${++ids}`, status: 'picked', summary: null, ...values };
          rows.push(row);
          return resolve({ data: { id: row.id }, error: null });
        }
        const hit = rows.filter((row) => filters.every((filter) => filter(row)));
        resolve({ data: single ? (hit[0] ?? null) : hit, error: null });
      },
    };
    return builder;
  };
  return { from } as unknown as LearnSupabaseClient;
}

function setUp(): Record<string, Row[]> {
  return {
    video_clips: [
      {
        id: 'clip-1',
        user_id: 'user-1',
        video_id: 'aaaaaaaaaaa',
        item_id: 'item-a',
        start_seconds: 320,
        end_seconds: 380,
        caption: 'Why cash runs out first',
        idea: 'A profitable firm can still run out of cash.',
        saved_at: '2026-10-02T10:00:00Z',
        not_interested_at: null,
      },
      // Not saved: no card.
      { id: 'clip-2', user_id: 'user-1', video_id: 'aaaaaaaaaaa', item_id: 'item-a', start_seconds: 30, end_seconds: 90, caption: 'Other', idea: null, saved_at: null, not_interested_at: null },
    ],
    catalogue_items: [{ id: 'item-a', title: 'Cash flow in ten minutes', author: 'A channel', provider: null }],
    catalogue_segments: [
      { id: 'seg-0', item_id: 'item-a', t_start_seconds: 0, t_end_seconds: 270 },
      { id: 'seg-1', item_id: 'item-a', t_start_seconds: 270, t_end_seconds: 540 },
    ],
    feed_cards: [
      // A card-pile stretch in the same segment holds idea_index 0.
      { id: 'stretch', user_id: 'user-1', reason: 'video', video_id: 'aaaaaaaaaaa', video_start_seconds: 280, clip_id: null, segment_id: 'seg-1', idea_index: 0, status: 'ready' },
    ],
  };
}

const transcript = vi.fn(async () => ({
  cues: [
    { startSeconds: 320, endSeconds: 350, text: words('cash') },
    { startSeconds: 350, endSeconds: 380, text: words('profit') },
  ],
}));

function writer(tables: Record<string, Row[]>, outcome: 'ready' | 'failed' = 'ready') {
  return vi.fn(async (_userId: string, card: CardToWrite): Promise<WriteResult> => {
    if (outcome === 'failed') return { outcome: 'failed', detail: 'The model call failed.' };
    const row = tables.feed_cards!.find((candidate) => candidate.id === card.id)!;
    Object.assign(row, { status: 'ready', idea_name: 'Cash before profit', summary: 'Why it holds.' });
    return { outcome: 'ready', why: 'From a clip you saved.', ideas: [] };
  });
}

describe('writeClipCards', () => {
  it('writes one card for a saved clip, opening at its start, and none again on the next run', async () => {
    const tables = setUp();
    const learn = fakeLearn(tables);
    const write = writer(tables);
    const first = await writeClipCards(learn, { deadline: Date.now() + 60_000, write, transcript });
    expect(first).toMatchObject({ written: 1, thin: 0, failed: 0 });

    const card = tables.feed_cards!.find((row) => row.clip_id === 'clip-1')!;
    expect(card).toMatchObject({
      reason: 'video',
      video_id: 'aaaaaaaaaaa',
      video_start_seconds: 320,
      video_end_seconds: 380,
      segment_id: 'seg-1',
      idea_index: 9,
      pick_basis: 'A profitable firm can still run out of cash.',
      status: 'ready',
    });
    const sent = write.mock.calls[0]![1];
    expect(sent.video?.point).toBe('A profitable firm can still run out of cash.');
    expect(sent.text).toContain('cash');
    expect(sent.maxIdeas).toBe(1);

    const second = await writeClipCards(learn, { deadline: Date.now() + 60_000, write, transcript });
    expect(second.written).toBe(0);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('leaves a failed write picked, and writes that same row on the next run', async () => {
    const tables = setUp();
    const learn = fakeLearn(tables);
    const failed = await writeClipCards(learn, { deadline: Date.now() + 60_000, write: writer(tables, 'failed'), transcript });
    expect(failed.failed).toBe(1);
    const write = writer(tables);
    const retried = await writeClipCards(learn, { deadline: Date.now() + 60_000, write, transcript });
    expect(retried.written).toBe(1);
    expect(tables.feed_cards!.filter((row) => row.clip_id === 'clip-1')).toHaveLength(1);
  });

  it('writes nothing for a clip with no transcript to write from', async () => {
    const tables = setUp();
    const write = writer(tables);
    const result = await writeClipCards(fakeLearn(tables), {
      deadline: Date.now() + 60_000,
      write,
      transcript: async () => null,
    });
    expect(result).toMatchObject({ written: 0, thin: 1 });
    expect(write).not.toHaveBeenCalled();
  });
});
