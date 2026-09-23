import { describe, expect, it } from 'vitest';

import { readStories } from './stories';

describe('readStories', () => {
  it('keeps each story with its headline, summary and link', () => {
    expect(
      readStories([
        { headline: 'Rates held', summary: 'The bank kept rates. It meets again in May.', link: 'https://example.com/a' },
        { headline: 'No link', summary: 'Two sentences. Both here.' },
      ]),
    ).toEqual([
      { headline: 'Rates held', summary: 'The bank kept rates. It meets again in May.', link: 'https://example.com/a' },
      { headline: 'No link', summary: 'Two sentences. Both here.' },
    ]);
  });

  it('reads null and anything that is not an array as no stories', () => {
    expect(readStories(null)).toEqual([]);
    expect(readStories({ headline: 'x', summary: 'y' })).toEqual([]);
  });

  it('drops a story missing its headline or summary', () => {
    expect(
      readStories([
        { headline: '', summary: 'y' },
        { headline: 'x' },
        'text',
        null,
        { headline: 'kept', summary: 'y' },
      ]),
    ).toEqual([{ headline: 'kept', summary: 'y' }]);
  });

  it('drops a link that is not http or https', () => {
    expect(
      readStories([{ headline: 'x', summary: 'y', link: 'javascript:alert(1)' }]),
    ).toEqual([{ headline: 'x', summary: 'y' }]);
  });
});
