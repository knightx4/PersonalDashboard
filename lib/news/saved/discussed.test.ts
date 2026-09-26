import { describe, expect, it } from 'vitest';
import { storyRef } from '@/lib/news/quick/discuss';
import { discussedIndexes } from './discussed';

const A = '6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const B = '7a2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e';

describe('discussedIndexes', () => {
  it('matches a saved story to its discussion by issue and headline', () => {
    const found = discussedIndexes(
      [
        { id: 's1', issueId: A, headline: 'Rates held' },
        { id: 's2', issueId: A, headline: 'Not discussed' },
        { id: 's3', issueId: B, headline: 'Rates held' },
      ],
      [{ ref: storyRef(A, 4), title: 'Rates held' }],
    );
    expect([...found]).toEqual([['s1', 4]]);
  });

  it('follows the headline, not the index, after a re-summary moved the story', () => {
    const found = discussedIndexes(
      [{ id: 's1', issueId: A, headline: 'Rates held' }],
      [
        { ref: storyRef(A, 0), title: 'Something else' },
        { ref: storyRef(A, 2), title: ' Rates held ' },
      ],
    );
    expect(found.get('s1')).toBe(2);
  });

  it('leaves out stories whose newsletter is gone and refs it did not write', () => {
    const found = discussedIndexes(
      [{ id: 's1', issueId: null, headline: 'Rates held' }],
      [
        { ref: storyRef(A, 1), title: 'Rates held' },
        { ref: 'card-1', title: 'Rates held' },
        { ref: storyRef(A, 3), title: null },
      ],
    );
    expect(found.size).toBe(0);
  });

  it('takes the lower index when two discussions in one issue share a headline', () => {
    const found = discussedIndexes(
      [{ id: 's1', issueId: A, headline: 'Rates held' }],
      [
        { ref: storyRef(A, 5), title: 'Rates held' },
        { ref: storyRef(A, 1), title: 'Rates held' },
      ],
    );
    expect(found.get('s1')).toBe(1);
  });
});
