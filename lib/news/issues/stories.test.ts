import { describe, expect, it } from 'vitest';

import { readStories, storyAddsToSummary, storyParagraphs } from './stories';

describe('readStories', () => {
  it('keeps each story with its headline, summary and link', () => {
    expect(
      readStories([
        {
          headline: 'Rates held',
          summary: 'The bank kept rates. It meets again in May.',
          link: 'https://example.com/a',
        },
        { headline: 'No link', summary: 'Two sentences. Both here.' },
      ]),
    ).toEqual([
      {
        headline: 'Rates held',
        summary: 'The bank kept rates. It meets again in May.',
        link: 'https://example.com/a',
      },
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

  it('keeps a topic from the list, drops one not on it, and reads none as none', () => {
    expect(
      readStories([
        { headline: 'Tagged', summary: 'y', topic: 'Climate' },
        { headline: 'Lower case', summary: 'y', topic: 'sport' },
        { headline: 'Untagged', summary: 'y' },
        { headline: 'Off the list', summary: 'y', topic: 'Crypto' },
        { headline: 'Blank', summary: 'y', topic: ' ' },
      ]),
    ).toEqual([
      { headline: 'Tagged', summary: 'y', topic: 'Climate' },
      { headline: 'Lower case', summary: 'y', topic: 'Sport' },
      { headline: 'Untagged', summary: 'y' },
      { headline: 'Off the list', summary: 'y' },
      { headline: 'Blank', summary: 'y' },
    ]);
  });

  it("keeps a story's picture and its own text", () => {
    expect(
      readStories([
        {
          headline: 'x',
          summary: 'y',
          image: ' https://cdn.example/a.jpg ',
          text: ' One.\n\nTwo. ',
        },
      ]),
    ).toEqual([
      { headline: 'x', summary: 'y', image: 'https://cdn.example/a.jpg', text: 'One.\n\nTwo.' },
    ]);
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

describe('storyAddsToSummary (note 86b9c6d1)', () => {
  it('is false when the text is the summary word for word', () => {
    expect(
      storyAddsToSummary(
        'The Fed held rates.\n\nMarkets rose!',
        'The Fed held rates. Markets rose.',
      ),
    ).toBe(false);
    expect(storyAddsToSummary('the fed held rates', 'The Fed held rates, markets rose.')).toBe(
      false,
    );
  });

  it('is false when the text differs from the summary by a word or two', () => {
    expect(
      storyAddsToSummary(
        'A judge has ordered Fox Corp. to hand over hundreds of documents about how Murdoch ran his companies.',
        'A judge has ordered Fox Corp. to turn over hundreds of documents about how Murdoch ran his companies.',
      ),
    ).toBe(false);
  });

  it('is true when the text says more', () => {
    expect(
      storyAddsToSummary(
        'The Fed held rates. Powell said more cuts may come.',
        'The Fed held rates.',
      ),
    ).toBe(true);
    expect(storyAddsToSummary('Anything at all.', undefined)).toBe(true);
  });

  it('is false with no text', () => {
    expect(storyAddsToSummary(undefined, 'A summary.')).toBe(false);
  });
});

describe('readStories importance', () => {
  it('keeps a whole-number rating from 1 to 5 and drops anything else', () => {
    const stories = readStories([
      { headline: 'A', summary: 'a', importance: 5 },
      { headline: 'B', summary: 'b', importance: '2' },
      { headline: 'C', summary: 'c', importance: 0 },
      { headline: 'D', summary: 'd', importance: 3.5 },
    ]);
    expect(stories.map((story) => story.importance)).toEqual([5, 2, undefined, undefined]);
  });
});
