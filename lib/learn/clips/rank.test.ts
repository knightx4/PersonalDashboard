import { describe, expect, it } from 'vitest';
import {
  EARLY_SKIP_SECONDS,
  FILING_CAP,
  isEarlySkip,
  leanFrom,
  MAX_PER_VIDEO,
  pickNextClips,
  PLAYLIST_BONUS,
  VIDEO_GAP,
  type ClipReaction,
  type RankableClip,
} from './rank';

/** Choosing the next clips (plan #1399), against a fixture library. */

const NOW = Date.parse('2026-10-02T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();

function clip(id: string, over: Partial<RankableClip> = {}): RankableClip {
  return {
    id,
    videoId: `vid-${id}`,
    cameFrom: 'playlist',
    score: 50,
    channel: 'channel a',
    theme: 'track:t1',
    shownAt: null,
    skippedAt: null,
    notInterestedAt: null,
    ...over,
  };
}

function reaction(over: Partial<ClipReaction>): ClipReaction {
  return {
    channel: null,
    theme: null,
    shownAt: ago(1),
    watchedSeconds: null,
    skippedAt: null,
    finishedAt: null,
    savedAt: null,
    ...over,
  };
}

const ids = (clips: RankableClip[]) => clips.map((c) => c.id);

describe('pickNextClips', () => {
  it('never returns a seen or not-interested clip', () => {
    const library = [
      clip('fresh', { score: 40 }),
      clip('seen', { score: 90, shownAt: ago(1) }),
      clip('finished-long-ago', { score: 90, shownAt: ago(60) }),
      clip('refused', { score: 95, notInterestedAt: ago(1) }),
      clip('refused-unseen-long-ago', { score: 95, notInterestedAt: ago(90), shownAt: ago(90), skippedAt: ago(90) }),
      clip('skipped-recently', { score: 99, shownAt: ago(3), skippedAt: ago(3) }),
    ];
    expect(ids(pickNextClips(library, { limit: 10, now: NOW }))).toEqual(['fresh']);
  });

  it('brings a skipped clip back after two weeks, after every unseen clip', () => {
    const library = [
      clip('back', { score: 99, shownAt: ago(15), skippedAt: ago(15), videoId: 'v1' }),
      clip('unseen-channel', { score: 10, cameFrom: 'channel', videoId: 'v2' }),
      clip('shown-again-lately', { score: 99, shownAt: ago(2), skippedAt: ago(20), videoId: 'v3' }),
    ];
    expect(ids(pickNextClips(library, { limit: 10, now: NOW }))).toEqual(['unseen-channel', 'back']);
  });

  it('never returns more than two from one video in a run', () => {
    const library = Array.from({ length: 6 }, (_, i) => clip(`same-${i}`, { videoId: 'talk', score: 90 - i }));
    for (let i = 0; i < 20; i++) library.push(clip(`other-${i}`, { score: 10 }));
    const picked = pickNextClips(library, { limit: 30, now: NOW });
    expect(picked.filter((c) => c.videoId === 'talk')).toHaveLength(MAX_PER_VIDEO);
  });

  it('counts clips already played this session against the cap', () => {
    const library = [clip('a', { videoId: 'talk' }), clip('b', { videoId: 'talk' }), clip('c', { videoId: 'x' })];
    const picked = pickNextClips(library, { limit: 10, now: NOW, playedThisSession: new Map([['talk', 1]]) });
    expect(picked.filter((c) => c.videoId === 'talk')).toHaveLength(1);
  });

  it('plays one video at most once in any ten clips', () => {
    const library = [clip('talk-1', { videoId: 'talk', score: 90 }), clip('talk-2', { videoId: 'talk', score: 89 })];
    for (let i = 0; i < 12; i++) library.push(clip(`other-${String(i).padStart(2, '0')}`, { score: 60 - i }));
    const picked = pickNextClips(library, { limit: 14, now: NOW });
    expect(picked[0].id).toBe('talk-1');
    // The second clip of the talk waits until nine others have played.
    expect(picked.findIndex((c) => c.id === 'talk-2')).toBe(VIDEO_GAP);
    expect(picked).toHaveLength(14);
  });

  it('returns fewer rather than play a video again too soon', () => {
    const library = [clip('talk-1', { videoId: 'talk' }), clip('talk-2', { videoId: 'talk' }), clip('x', { videoId: 'x' })];
    expect(ids(pickNextClips(library, { limit: 5, now: NOW }))).toEqual(['talk-1', 'x']);
  });

  it('counts the clips played before this call against the gap', () => {
    const library = [clip('talk-2', { videoId: 'talk', score: 99 }), clip('x', { videoId: 'x', score: 10 })];
    const recent = ['talk', ...Array.from({ length: VIDEO_GAP - 2 }, (_, i) => `seen-${i}`)];
    // talk played nine clips back: still too soon, so x plays and then talk may.
    expect(ids(pickNextClips(library, { limit: 2, now: NOW, recentVideos: recent }))).toEqual(['x', 'talk-2']);
    // Ten back: it plays first.
    expect(ids(pickNextClips(library, { limit: 2, now: NOW, recentVideos: [...recent, 'one-more'] }))).toEqual([
      'talk-2',
      'x',
    ]);
  });

  it('ranks a higher Jev score above a lower one', () => {
    const library = [clip('low', { score: 30 }), clip('high', { score: 80 }), clip('mid', { score: 55 })];
    expect(ids(pickNextClips(library, { limit: 3, now: NOW }))).toEqual(['high', 'mid', 'low']);
  });

  it('keeps the higher score above the lower once skips and saves are applied', () => {
    const library = [
      clip('liked-channel', { score: 60, channel: 'liked', theme: null }),
      clip('skipped-channel', { score: 62, channel: 'skipped', theme: null }),
      clip('neutral', { score: 61, channel: 'neutral', theme: null }),
    ];
    const reactions = [
      reaction({ channel: 'liked', savedAt: ago(1) }),
      reaction({ channel: 'liked', finishedAt: ago(2) }),
      reaction({ channel: 'skipped', skippedAt: ago(1), watchedSeconds: 2 }),
    ];
    // liked: 60 + 8 = 68; neutral: 61; skipped: 62 - 6 = 56.
    expect(ids(pickNextClips(library, { limit: 3, now: NOW, reactions }))).toEqual([
      'liked-channel',
      'neutral',
      'skipped-channel',
    ]);
  });

  it('pushes down a theme skipped in the first few seconds', () => {
    const library = [clip('a', { score: 70, theme: 'track:dull' }), clip('b', { score: 66, theme: 'track:good' })];
    const reactions = [reaction({ theme: 'track:dull', skippedAt: ago(1), watchedSeconds: 1 })];
    expect(ids(pickNextClips(library, { limit: 2, now: NOW, reactions }))).toEqual(['b', 'a']);
  });

  it('lifts clips of a track from a recent Learn now card', () => {
    const library = [clip('a', { score: 70, theme: 'track:x' }), clip('b', { score: 67, theme: 'track:card' })];
    const picked = pickNextClips(library, { limit: 2, now: NOW, recentThemes: new Set(['track:card']) });
    expect(ids(picked)).toEqual(['b', 'a']);
  });

  it('mixes playlist and channel clips by score, with the playlist leaning ahead', () => {
    const library = [
      clip('channel-high', { cameFrom: 'channel', score: 90 }),
      clip('playlist-mid', { cameFrom: 'playlist', score: 70 }),
      clip('channel-close', { cameFrom: 'channel', score: 70 + PLAYLIST_BONUS - 1 }),
      clip('channel-low', { cameFrom: 'channel', score: 20 }),
    ];
    expect(ids(pickNextClips(library, { limit: 10, now: NOW }))).toEqual([
      'channel-high',
      'playlist-mid',
      'channel-close',
      'channel-low',
    ]);
  });

  it('leaves out excluded clips and stops at the limit', () => {
    const library = [clip('a', { score: 90 }), clip('b', { score: 80 }), clip('c', { score: 70 })];
    expect(ids(pickNextClips(library, { limit: 1, now: NOW, excludeIds: new Set(['a']) }))).toEqual(['b']);
  });
});

describe('the filings', () => {
  it('counts a skip as early only under the threshold', () => {
    expect(isEarlySkip(reaction({ skippedAt: ago(1), watchedSeconds: EARLY_SKIP_SECONDS - 1 }))).toBe(true);
    expect(isEarlySkip(reaction({ skippedAt: ago(1), watchedSeconds: EARLY_SKIP_SECONDS }))).toBe(false);
  });

  it('falls back to the time between shown and skipped when watched seconds are missing', () => {
    const shown = '2026-10-01T10:00:00Z';
    expect(isEarlySkip(reaction({ shownAt: shown, skippedAt: '2026-10-01T10:00:03Z' }))).toBe(true);
    expect(isEarlySkip(reaction({ shownAt: shown, skippedAt: '2026-10-01T10:00:30Z' }))).toBe(false);
  });

  it('caps how far filings move a channel', () => {
    const many = Array.from({ length: 20 }, () => reaction({ channel: 'x', skippedAt: ago(1), watchedSeconds: 0 }));
    expect(leanFrom(many).channel.get('x')).toBe(-FILING_CAP);
  });

  it('counts a clip skipped early and later saved as liked', () => {
    const lean = leanFrom([reaction({ channel: 'x', skippedAt: ago(1), watchedSeconds: 1, savedAt: ago(1) })]);
    expect(lean.channel.get('x')).toBeGreaterThan(0);
  });
});
