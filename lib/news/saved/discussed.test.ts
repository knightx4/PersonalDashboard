import { describe, expect, it } from 'vitest';
import { discussedIndexes, savedStoryIdOf } from './discussed';

const A = '6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const B = '7a2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e';

const story = (headline: string) => ({ headline, summary: 'S.' });

describe('savedStoryIdOf', () => {
  it('reads the saved story id from its thread ref and nothing else', () => {
    expect(savedStoryIdOf('news.saved_stories:s1')).toBe('s1');
    expect(savedStoryIdOf('learn.feed_cards:c1')).toBeNull();
    expect(savedStoryIdOf('news.saved_stories:')).toBeNull();
  });
});

describe('discussedIndexes', () => {
  it('finds each discussed saved story in its newsletter by headline', () => {
    const found = discussedIndexes(
      [
        { id: 's1', issueId: A, headline: 'Rates held' },
        { id: 's2', issueId: A, headline: 'Not discussed' },
        { id: 's3', issueId: B, headline: 'Rates held' },
      ],
      new Set(['s1']),
      new Map([
        [A, [story('Other'), story('Not discussed'), story('x'), story('y'), story(' Rates held ')]],
        [B, [story('Rates held')]],
      ]),
    );
    expect([...found]).toEqual([['s1', 4]]);
  });

  it('counts the index in the raw array, malformed entries included', () => {
    const found = discussedIndexes(
      [{ id: 's1', issueId: A, headline: 'Rates held' }],
      new Set(['s1']),
      new Map([[A, [null, story('Rates held')]]]),
    );
    expect(found.get('s1')).toBe(1);
  });

  it('leaves out stories whose newsletter is gone or no longer holds them', () => {
    const found = discussedIndexes(
      [
        { id: 's1', issueId: null, headline: 'Rates held' },
        { id: 's2', issueId: A, headline: 'Rates held' },
        { id: 's3', issueId: B, headline: 'Gone' },
      ],
      new Set(['s1', 's2', 's3']),
      new Map([[B, [story('Something else')]]]),
    );
    expect(found.size).toBe(0);
  });
});
