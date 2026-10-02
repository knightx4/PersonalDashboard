import { describe, expect, it } from 'vitest';
import { appendClips, isSwipeUp, leaveWrite, reachedEnd, shouldRefill, watchedSeconds, type PlayerClip } from './stream';

const clip = (id: string, start = 100, end = 160): PlayerClip => ({
  id,
  videoId: 'ZK3O402wf1c',
  startSeconds: start,
  endSeconds: end,
  caption: 'A point',
  title: null,
  channel: null,
  saved: false,
});

describe('watchedSeconds', () => {
  it('counts from the clip start and stays inside the clip', () => {
    expect(watchedSeconds(clip('a'), 112.4)).toBeCloseTo(12.4);
    expect(watchedSeconds(clip('a'), 90)).toBe(0);
    expect(watchedSeconds(clip('a'), 400)).toBe(60);
    expect(watchedSeconds(clip('a'), null)).toBe(0);
  });
});

describe('reachedEnd', () => {
  it('allows the player to stop a moment short', () => {
    expect(reachedEnd(clip('a'), 159.5)).toBe(true);
    expect(reachedEnd(clip('a'), 150)).toBe(false);
    expect(reachedEnd(clip('a'), null)).toBe(false);
  });
});

describe('shouldRefill', () => {
  it('asks for more when two or fewer are left after the one playing', () => {
    expect(shouldRefill(5, 1, { loading: false, exhausted: false })).toBe(false);
    expect(shouldRefill(5, 2, { loading: false, exhausted: false })).toBe(true);
    expect(shouldRefill(1, 0, { loading: false, exhausted: false })).toBe(true);
  });

  it('waits on a fetch in flight and stops after an empty one', () => {
    expect(shouldRefill(1, 0, { loading: true, exhausted: false })).toBe(false);
    expect(shouldRefill(1, 0, { loading: false, exhausted: true })).toBe(false);
  });
});

describe('appendClips', () => {
  it('adds only clips not already queued', () => {
    const queue = appendClips([clip('a'), clip('b')], [clip('b'), clip('c')]);
    expect(queue.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('leaveWrite', () => {
  it('writes nothing for a clip that never played', () => {
    expect(leaveWrite(clip('a'), 'next', { shown: false, currentTime: null })).toBeNull();
  });

  it('writes nothing more for not interested', () => {
    expect(leaveWrite(clip('a'), 'not-interested', { shown: true, currentTime: 120 })).toBeNull();
  });

  it('skips with the seconds watched when left early', () => {
    expect(leaveWrite(clip('a'), 'next', { shown: true, currentTime: 103 })).toEqual({ kind: 'skipped', watched: 3 });
  });

  it('finishes a clip that ended, or was swiped at its last moment', () => {
    expect(leaveWrite(clip('a'), 'ended', { shown: true, currentTime: 158 })).toEqual({ kind: 'finished', watched: 60 });
    expect(leaveWrite(clip('a'), 'next', { shown: true, currentTime: 159.6 })).toEqual({ kind: 'finished', watched: 60 });
  });
});

describe('isSwipeUp', () => {
  it('takes a quick upward drag and refuses a sideways or slow one', () => {
    expect(isSwipeUp(5, -120, 250)).toBe(true);
    expect(isSwipeUp(100, -80, 250)).toBe(false);
    expect(isSwipeUp(0, -30, 250)).toBe(false);
    expect(isSwipeUp(0, -200, 1500)).toBe(false);
    expect(isSwipeUp(0, 150, 200)).toBe(false);
  });
});
