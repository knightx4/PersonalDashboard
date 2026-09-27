import { describe, expect, it } from 'vitest';
import { storyHits } from './news-map';

const story = (headline: string, summary = 'A summary.') => ({ headline, summary });

describe('news search hits', () => {
  const issues = [
    { id: 'i2', subject: 'Morning Brief', stories: [story('Rates held again'), story('Some Chickens')] },
    { id: 'i1', subject: 'Evening Wrap', stories: [story('Rates Held Again'), story('Harbour reopens')] },
  ];

  it('finds a story by part of its headline and opens its issue', () => {
    const hits = storyHits(issues, { query: 'chick', limit: 6 });
    expect(hits).toEqual([
      {
        module: 'news',
        kind: 'story',
        id: 'i2:1',
        title: 'Some Chickens',
        subtitle: 'Story · Morning Brief',
        href: '/news/i/i2',
      },
    ]);
  });

  it('keeps a repeated headline once, from the newest issue', () => {
    const hits = storyHits(issues, { query: 'rates held', limit: 6 });
    expect(hits.map((hit) => hit.href)).toEqual(['/news/i/i2']);
  });

  it('does not match on the summary', () => {
    expect(storyHits([{ id: 'i', subject: null, stories: [story('Title', 'harbour')] }], {
      query: 'harbour',
      limit: 6,
    })).toEqual([]);
  });

  it('lists every story with no query, up to the cap', () => {
    expect(storyHits(issues, { limit: 10 }).map((hit) => hit.title)).toEqual([
      'Rates held again',
      'Some Chickens',
      'Harbour reopens',
    ]);
    expect(storyHits(issues, { limit: 2 })).toHaveLength(2);
  });

  it('skips a malformed stories column', () => {
    expect(storyHits([{ id: 'i', subject: 'S', stories: { not: 'an array' } }], { limit: 6 })).toEqual([]);
  });
});
