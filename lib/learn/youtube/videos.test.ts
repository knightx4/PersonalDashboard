import { describe, expect, it } from 'vitest';
import { closestIdeas, filterVideos, type ListVideo } from './videos';

const video = (videoId: string, title: string, channel: string | null, verdict: ListVideo['verdict'] = null): ListVideo => ({
  videoId,
  title,
  channel,
  durationSeconds: 600,
  addedAt: '2026-09-26T10:00:00Z',
  watchedAt: null,
  verdict,
  why: null,
  bestStartSeconds: null,
  bestEndSeconds: null,
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
