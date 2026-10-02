import { describe, expect, it } from 'vitest';
import {
  mirroredState,
  planInspirationSync,
  transcriptsToFetch,
  type CacheRow,
  type InspirationVideoRow,
} from './sync';

const row = (video_id: string, playlist_position: number | null, left_playlist_at: string | null = null): InspirationVideoRow => ({
  video_id,
  playlist_position,
  left_playlist_at,
});

const cache = (video_id: string, state: CacheRow['state'], extra: Partial<CacheRow> = {}): CacheRow => ({
  video_id,
  state,
  attempts: 0,
  retry_after: null,
  last_error: null,
  ...extra,
});

const NOW = new Date('2026-10-02T12:00:00Z');

describe('planInspirationSync', () => {
  it('adds what is new on the playlist, in playlist order', () => {
    expect(planInspirationSync(['c', 'a', 'b'], [row('a', 1)], true)).toEqual({
      add: ['c', 'b'],
      left: [],
      back: [],
      moved: [],
    });
  });

  it('marks a video taken off the playlist, and clears the mark when it comes back', () => {
    const stored = [row('a', 0), row('b', 1), row('c', 2, '2026-09-20T00:00:00Z')];
    const plan = planInspirationSync(['a', 'c'], stored, true);
    expect(plan.left).toEqual(['b']);
    expect(plan.back).toEqual(['c']);
  });

  it('marks nothing gone when the listing stopped short', () => {
    expect(planInspirationSync(['a'], [row('a', 0), row('b', 1)], false).left).toEqual([]);
  });

  it('does not mark a video gone twice', () => {
    expect(planInspirationSync([], [row('a', 0, '2026-09-20T00:00:00Z')], true).left).toEqual([]);
  });

  it('records a stored video whose place in the playlist changed', () => {
    expect(planInspirationSync(['b', 'a'], [row('a', 0), row('b', 1)], true).moved).toEqual([
      { videoId: 'a', position: 1 },
      { videoId: 'b', position: 0 },
    ]);
  });

  it('does not move a video that has left', () => {
    expect(planInspirationSync(['a'], [row('a', 0), row('b', 1)], true).moved).toEqual([]);
  });
});

describe('transcriptsToFetch', () => {
  it('calls for a video the cache has never seen, and says it is new', () => {
    expect(transcriptsToFetch(['aaaaaaaaaaa'], [], NOW)).toEqual({ fetch: ['aaaaaaaaaaa'], fresh: ['aaaaaaaaaaa'] });
  });

  it('spends nothing on a video already fetched, by Learn or an earlier run', () => {
    expect(transcriptsToFetch(['a'], [cache('a', 'fetched')], NOW)).toEqual({ fetch: [], fresh: [] });
  });

  it('waits out a no-captions answer and a failure back-off', () => {
    const later = '2026-10-20T00:00:00Z';
    const rows = [cache('a', 'none', { retry_after: later }), cache('b', 'failed', { attempts: 1, retry_after: later })];
    expect(transcriptsToFetch(['a', 'b'], rows, NOW).fetch).toEqual([]);
  });

  it('tries again once the wait is over, and gives up after five failures', () => {
    const earlier = '2026-10-01T00:00:00Z';
    const rows = [
      cache('a', 'none', { retry_after: earlier }),
      cache('b', 'failed', { attempts: 2, retry_after: earlier }),
      cache('c', 'failed', { attempts: 5 }),
      cache('d', 'queued'),
    ];
    expect(transcriptsToFetch(['a', 'b', 'c', 'd'], rows, NOW).fetch).toEqual(['a', 'b', 'd']);
  });
});

describe('mirroredState', () => {
  it('copies the cache state, with the error only when there is no transcript', () => {
    expect(mirroredState(cache('a', 'fetched', { last_error: 'old' }))).toEqual({
      transcript_state: 'fetched',
      transcript_error: null,
    });
    expect(mirroredState(cache('a', 'none', { last_error: 'no captions' }))).toEqual({
      transcript_state: 'none',
      transcript_error: 'no captions',
    });
  });

  it('leaves a video queued when the cache has no row for it', () => {
    expect(mirroredState(undefined)).toEqual({ transcript_state: 'queued', transcript_error: null });
  });
});
