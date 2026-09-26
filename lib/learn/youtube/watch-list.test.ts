import { describe, expect, it } from 'vitest';
import { planWatchList, type WatchListRow } from './watch-list';

const row = (video_id: string, left_playlist_at: string | null = null): WatchListRow => ({
  video_id,
  item_id: 'item',
  left_playlist_at,
});

describe('planWatchList', () => {
  it('adds what is new on the playlist, in playlist order', () => {
    expect(planWatchList(['c', 'a', 'b'], [row('a')], true)).toEqual({ add: ['c', 'b'], left: [], back: [] });
  });

  it('marks a video taken off the playlist, and clears the mark when it comes back', () => {
    const stored = [row('a'), row('b'), row('c', '2026-09-20T00:00:00Z')];
    expect(planWatchList(['a', 'c'], stored, true)).toEqual({ add: [], left: ['b'], back: ['c'] });
  });

  it('marks nothing gone when the listing stopped short', () => {
    expect(planWatchList(['a'], [row('a'), row('b')], false).left).toEqual([]);
  });

  it('does not mark a video gone twice', () => {
    expect(planWatchList([], [row('a', '2026-09-20T00:00:00Z')], true).left).toEqual([]);
  });
});
