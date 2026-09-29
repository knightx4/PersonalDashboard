import { describe, expect, it } from 'vitest';
import { closestIdeas, filterVideos, pileCounts, verdictReason, videoHref, type ListVideo } from './videos';

const video = (videoId: string, title: string, channel: string | null, verdict: ListVideo['verdict'] = null): ListVideo => ({
  videoId,
  title,
  channel,
  durationSeconds: 600,
  addedAt: '2026-09-26T10:00:00Z',
  watchedAt: null,
  verdict,
  verdictBy: verdict ? 'judge' : null,
  judgeVerdict: verdict,
  why: null,
  bestStartSeconds: null,
  bestEndSeconds: null,
  screenedAt: null,
  stretchCount: 0,
  foundFor: null,
});

const list = [
  video('aaaaaaaaaaa', 'How tides work', 'Sixty Symbols', 'watch'),
  video('bbbbbbbbbbb', 'The Kelly criterion', 'Numberphile', 'skip'),
  video('ccccccccccc', 'Tidal locking', null),
];

describe('filterVideos', () => {
  it('keeps everything, in order, with no search', () => {
    expect(filterVideos(list, {}).map((v) => v.videoId)).toEqual(['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc']);
  });

  it('matches every word against the title and the channel, ignoring case', () => {
    expect(filterVideos(list, { q: 'TID' }).map((v) => v.title)).toEqual(['How tides work', 'Tidal locking']);
    expect(filterVideos(list, { q: 'tides sixty' }).map((v) => v.title)).toEqual(['How tides work']);
    expect(filterVideos(list, { q: 'numberphile' }).map((v) => v.title)).toEqual(['The Kelly criterion']);
  });

  it('narrows to one verdict', () => {
    expect(filterVideos(list, { verdict: 'skip' }).map((v) => v.title)).toEqual(['The Kelly criterion']);
  });

  it('narrows to the videos not judged yet, and counts each pile', () => {
    expect(filterVideos(list, { verdict: 'unjudged' }).map((v) => v.title)).toEqual(['Tidal locking']);
    expect(filterVideos(list, { verdict: 'watch', q: 'kelly' })).toEqual([]);
    expect(pileCounts(list)).toEqual({ watch: 1, card: 0, skip: 1, unjudged: 1 });
  });
});

describe('videoHref', () => {
  it('opens a Watch video at its best minute and anything else at the start', () => {
    const watch = { ...video('aaaaaaaaaaa', 'How tides work', null, 'watch'), bestStartSeconds: 724 };
    expect(videoHref(watch)).toBe('/learn/videos/aaaaaaaaaaa?t=724');
    expect(videoHref({ ...watch, bestStartSeconds: null })).toBe('/learn/videos/aaaaaaaaaaa');
    // Moved to card, it keeps the minute but no longer opens there.
    expect(videoHref({ ...watch, verdict: 'card' })).toBe('/learn/videos/aaaaaaaaaaa');
  });
});

describe('verdictReason', () => {
  const judged = { ...video('bbbbbbbbbbb', 'The Kelly criterion', null, 'skip'), why: 'Touches none of your tracks.' };

  it('gives the judge\'s reason for its own verdict', () => {
    expect(verdictReason(judged)).toBe('Touches none of your tracks.');
  });

  it('says a video you moved was yours, and what the judge had said', () => {
    expect(verdictReason({ ...judged, verdict: 'watch', verdictBy: 'you' })).toBe(
      'You moved this from skip. The judge had said: Touches none of your tracks.',
    );
    expect(verdictReason({ ...judged, verdict: 'watch', verdictBy: 'you', judgeVerdict: null, why: null })).toBe(
      'Filed by you before the judge read it.',
    );
  });

  it('says what a video with no verdict is waiting for', () => {
    expect(verdictReason({ ...judged, verdict: null, verdictBy: null, why: null })).toMatch(/next library run/);
    expect(verdictReason({ ...judged, verdict: null, verdictBy: null, screenedAt: '2026-09-26T10:00:00Z' })).toMatch(
      /waits on its transcript/,
    );
  });
});

describe('closestIdeas', () => {
  it('keeps each idea once at its best score, best first, at most three', () => {
    const found = closestIdeas([
      [
        { conceptId: 'a', name: 'Tides', similarity: 0.6 },
        { conceptId: 'b', name: 'Gravity', similarity: 0.55 },
      ],
      [
        { conceptId: 'a', name: 'Tides', similarity: 0.7 },
        { conceptId: 'c', name: 'Orbits', similarity: 0.65 },
        { conceptId: 'd', name: 'Moon', similarity: 0.51 },
      ],
    ]);
    expect(found.map((idea) => [idea.conceptId, idea.similarity])).toEqual([
      ['a', 0.7],
      ['c', 0.65],
      ['b', 0.55],
    ]);
  });

  it('finds nothing in nothing', () => {
    expect(closestIdeas([[], []])).toEqual([]);
  });
});
