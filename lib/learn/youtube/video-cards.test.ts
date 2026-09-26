import { describe, expect, it } from 'vitest';
import {
  planVideoCards,
  readStretches,
  stretchLabel,
  stretchText,
  WITHDRAWN,
  type PileVideo,
  type StoredVideoCard,
} from './video-cards';

/**
 * Which cards the card pile should have (plan #1067): one per stretch, never
 * two, set aside when the video leaves the pile and back when it returns.
 */

const stretch = (startSeconds: number, endSeconds: number, point = `Point at ${startSeconds}`) => ({
  startSeconds,
  endSeconds,
  point,
});

const video = (videoId: string, stretches = [stretch(60, 180), stretch(600, 720)]): PileVideo => ({
  userId: 'u1',
  videoId,
  itemId: `item-${videoId}`,
  title: `Video ${videoId}`,
  channel: 'A channel',
  stretches,
});

const card = (videoId: string, startSeconds: number, extra: Partial<StoredVideoCard> = {}): StoredVideoCard => ({
  id: `${videoId}-${startSeconds}`,
  userId: 'u1',
  videoId,
  startSeconds,
  status: 'ready',
  dropReason: null,
  hasSummary: true,
  ...extra,
});

describe('readStretches', () => {
  it('keeps well-formed stretches in order, whole seconds, one per start', () => {
    expect(
      readStretches([
        { startSeconds: 61.4, endSeconds: 179.2, point: ' Cash is a timing problem. ' },
        { startSeconds: 61, endSeconds: 200, point: 'Same start again' },
        { startSeconds: 300, endSeconds: 200, point: 'Ends before it starts' },
        { startSeconds: 400, endSeconds: 500, point: '' },
        { startSeconds: '10', endSeconds: 20, point: 'Not a number' },
        null,
        { startSeconds: 600, endSeconds: 720, point: 'Working capital' },
      ]),
    ).toEqual([stretch(61, 180, 'Cash is a timing problem.'), stretch(600, 720, 'Working capital')]);
  });

  it('reads anything but an array as none', () => {
    expect(readStretches(null)).toEqual([]);
    expect(readStretches({ startSeconds: 1 })).toEqual([]);
  });
});

describe('planVideoCards', () => {
  it('writes a card for each stretch of a new video', () => {
    const plan = planVideoCards([video('a')], []);
    expect(plan.write.map((job) => [job.stretch.startSeconds, job.index, job.cardId])).toEqual([
      [60, 0, undefined],
      [600, 1, undefined],
    ]);
    expect(plan.withdraw).toEqual([]);
    expect(plan.revive).toEqual([]);
  });

  it('writes nothing again once each stretch has its card, whatever became of it', () => {
    const stored = [card('a', 60, { status: 'saved' }), card('a', 600, { status: 'dropped', dropReason: 'No idea.', hasSummary: false })];
    expect(planVideoCards([video('a')], stored)).toEqual({ write: [], revive: [], withdraw: [] });
  });

  it('writes a claimed card again when an earlier run left it unwritten', () => {
    const plan = planVideoCards([video('a')], [card('a', 60, { status: 'picked', hasSummary: false }), card('a', 600)]);
    expect(plan.write.map((job) => [job.stretch.startSeconds, job.cardId])).toEqual([[60, 'a-60']]);
  });

  it('sets aside the unacted cards of a video that left the pile, and keeps what you acted on', () => {
    const stored = [
      card('gone', 60),
      card('gone', 600, { status: 'skipped' }),
      card('gone', 900, { status: 'saved' }),
      card('gone', 1200, { status: 'review' }),
      card('gone', 1500, { status: 'known' }),
    ];
    expect(planVideoCards([], stored).withdraw).toEqual(['gone-60', 'gone-600']);
  });

  it('sets aside a card whose stretch is no longer among the video’s', () => {
    const plan = planVideoCards([video('a', [stretch(60, 180)])], [card('a', 60), card('a', 600)]);
    expect(plan.withdraw).toEqual(['a-600']);
    expect(plan.write).toEqual([]);
  });

  it('brings a withdrawn card back when its video returns, and never one the writer turned down', () => {
    const stored = [
      card('a', 60, { status: 'dropped', dropReason: WITHDRAWN }),
      card('a', 600, { status: 'dropped', dropReason: 'The transcript does not make the point.', hasSummary: false }),
    ];
    expect(planVideoCards([video('a')], stored)).toEqual({ write: [], revive: ['a-60'], withdraw: [] });
  });

  it('keeps one person’s cards apart from another’s on the same video', () => {
    const plan = planVideoCards([video('a')], [card('a', 60, { userId: 'u2' })]);
    expect(plan.write).toHaveLength(2);
    expect(plan.withdraw).toEqual(['a-60']);
  });
});

describe('stretchText', () => {
  const words = (label: string) => `${label} `.repeat(80).trim();
  const segments = [
    { id: 's0', start: 0, end: 120, text: words('zero') },
    { id: 's1', start: 120, end: 240, text: words('one') },
    { id: 's2', start: 240, end: null, text: words('two') },
  ];

  it('joins every segment the stretch overlaps, anchored on the one it starts in', () => {
    const got = stretchText(segments, { startSeconds: 100, endSeconds: 200 });
    expect(got?.segmentId).toBe('s0');
    expect(got?.text).toBe(`${words('zero')}\n\n${words('one')}`);
  });

  it('reads an open-ended last segment as running to the end', () => {
    expect(stretchText(segments, { startSeconds: 500, endSeconds: 600 })?.segmentId).toBe('s2');
  });

  it('gives nothing when the transcript there is too thin to write from', () => {
    expect(stretchText([{ id: 'c', start: 0, end: 600, text: 'Chapter 1: Intro' }], { startSeconds: 0, endSeconds: 60 })).toBeNull();
    expect(stretchText([], { startSeconds: 0, endSeconds: 60 })).toBeNull();
  });
});

describe('stretchLabel', () => {
  it('writes the stretch as clock times', () => {
    expect(stretchLabel({ startSeconds: 724, endSeconds: 3725 })).toBe('12:04 to 1:02:05');
  });
});
