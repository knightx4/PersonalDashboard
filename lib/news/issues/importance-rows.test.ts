import { describe, expect, it } from 'vitest';
import { applyRatings, unrated } from './importance-rows';

const stored = [
  { headline: 'War', summary: 'It began.', topic: 'World' },
  { headline: '', summary: 'No headline.' },
  { headline: 'Quiz', summary: 'Try it.', topic: 'Other', importance: 1 },
  { headline: 'Rates', summary: 'They rose.', importance: 9 },
];

describe('unrated', () => {
  it('lists readable stories without a valid rating, by stored position', () => {
    expect(unrated(stored)).toEqual([
      { index: 0, headline: 'War', summary: 'It began.', topic: 'World' },
      { index: 3, headline: 'Rates', summary: 'They rose.', topic: null },
    ]);
    expect(unrated(null)).toEqual([]);
  });
});

describe('applyRatings', () => {
  const asked = unrated(stored);

  it('writes each rating onto its story and leaves the rest alone', () => {
    const { stories, rated } = applyRatings(stored, asked, [
      { number: 0, importance: 5 },
      { number: 3, importance: 3 },
    ]);
    expect(rated).toBe(2);
    expect(stories).toEqual([
      { ...stored[0], importance: 5 },
      stored[1],
      stored[2],
      { ...stored[3], importance: 3 },
    ]);
  });

  it('ignores a rating for a story not asked about, out of range, or since changed', () => {
    const changed = [{ ...stored[0], headline: 'Something else' }, ...stored.slice(1)];
    const { stories, rated } = applyRatings(changed, asked, [
      { number: 0, importance: 5 },
      { number: 2, importance: 4 },
      { number: 3, importance: 7 },
      { number: 'x', importance: 2 },
    ]);
    expect(rated).toBe(0);
    expect(stories).toEqual(changed);
  });
});
