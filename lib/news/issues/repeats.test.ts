import { describe, expect, it } from 'vitest';
import {
  bandPairs,
  cosine,
  countsAtCutoffs,
  repeatText,
  similarPairs,
  type PlacedStory,
} from './repeats';

const DAY = 24 * 60 * 60 * 1000;

function placed(id: string, senderId: string, receivedAt: number): PlacedStory {
  return {
    issueId: id,
    index: 0,
    senderId,
    senderName: senderId,
    receivedAt,
    story: { headline: `Headline ${id}`, summary: `Summary ${id}` },
  };
}

describe('repeatText', () => {
  it('embeds the headline and then the summary', () => {
    expect(repeatText({ headline: 'Fed holds', summary: 'Rates stay put.' })).toBe(
      'Fed holds\nRates stay put.',
    );
  });
});

describe('cosine', () => {
  it('is 1 for the same direction and 0 for a vector with no length', () => {
    expect(cosine([1, 2], [2, 4])).toBeCloseTo(1);
    expect(cosine([0, 0], [1, 0])).toBe(0);
  });

  it('refuses vectors of different widths', () => {
    expect(() => cosine([1], [1, 2])).toThrow();
  });
});

describe('similarPairs', () => {
  const same = [1, 0];
  const close = [0.8, 0.6];

  it('pairs stories from different newsletters within two days', () => {
    const stories = [placed('a', 'axios', 0), placed('b', 'brew', DAY)];
    const pairs = similarPairs(stories, [same, close], 0.7);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].similarity).toBeCloseTo(0.8);
  });

  it('never pairs two stories from the same newsletter', () => {
    const stories = [placed('a', 'axios', 0), placed('b', 'axios', 0)];
    expect(similarPairs(stories, [same, same], 0.7)).toEqual([]);
  });

  it('never pairs stories more than two days apart', () => {
    const stories = [placed('a', 'axios', 0), placed('b', 'brew', 2 * DAY + 1)];
    expect(similarPairs(stories, [same, same], 0.7)).toEqual([]);
  });

  it('leaves out pairs below the floor and sorts the rest most similar first', () => {
    const stories = [placed('a', 'axios', 0), placed('b', 'brew', 0), placed('c', 'hustle', 0)];
    const pairs = similarPairs(stories, [same, close, same], 0.85);
    expect(pairs.map((pair) => [pair.a.issueId, pair.b.issueId])).toEqual([['a', 'c']]);
  });

  it('refuses a vector list that does not match the stories', () => {
    expect(() => similarPairs([placed('a', 'axios', 0)], [], 0.7)).toThrow();
  });
});

describe('bands and counts', () => {
  const stories = [placed('a', 'x', 0), placed('b', 'y', 0)];
  const at = (similarity: number) => ({ a: stories[0], b: stories[1], similarity });
  const pairs = [at(0.95), at(0.9), at(0.82), at(0.71)];

  it('puts each pair in the band between two cut-offs, the top band running to 1', () => {
    const bands = bandPairs(pairs);
    expect(bands.map((band) => [band.from, band.to, band.pairs.length])).toEqual([
      [0.7, 0.75, 1],
      [0.75, 0.8, 0],
      [0.8, 0.85, 1],
      [0.85, 0.9, 0],
      [0.9, null, 2],
    ]);
  });

  it('counts the pairs at or above each cut-off', () => {
    expect(countsAtCutoffs(pairs).map((row) => row.pairs)).toEqual([4, 3, 3, 2, 2]);
  });
});
