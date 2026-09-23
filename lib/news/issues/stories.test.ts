import { describe, expect, it } from 'vitest';

import { readStories, storyParagraphs } from './stories';

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

  it('drops a link or picture that is not http or https', () => {
    expect(
      readStories([
        {
          headline: 'x',
          summary: 'y',
          link: 'javascript:alert(1)',
          image: 'data:image/svg+xml,<svg onload=alert(1)>',
        },
      ]),
    ).toEqual([{ headline: 'x', summary: 'y' }]);
  });

  it("keeps a story's picture and its own text", () => {
    expect(
      readStories([
        { headline: 'x', summary: 'y', image: ' https://cdn.example/a.jpg ', text: ' One.\n\nTwo. ' },
      ]),
    ).toEqual([{ headline: 'x', summary: 'y', image: 'https://cdn.example/a.jpg', text: 'One.\n\nTwo.' }]);
  });
});

describe('storyParagraphs', () => {
  it('splits on blank lines and folds the lines inside a paragraph', () => {
    expect(storyParagraphs('One\nline.\n\n\n  Two.  \n \nThree.')).toEqual([
      'One line.',
      'Two.',
      'Three.',
    ]);
    expect(storyParagraphs(undefined)).toEqual([]);
  });
});
