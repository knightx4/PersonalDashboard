import { describe, expect, it } from 'vitest';
import {
  ACTION_FROM,
  SWIPES,
  appendCards,
  cardTitle,
  feedEnd,
  licenceFor,
  sectionLink,
  siteName,
  splitForReading,
  toFeedCard,
  type FeedCard,
  type FeedCardRow,
} from './card';

/**
 * A Learn now card as the page shows it: the title, the link, the licence,
 * how the section folds, and which status each action moves a card from.
 */

function row(overrides: Partial<FeedCardRow> = {}): FeedCardRow {
  return {
    id: 'c1',
    reason: 'interest',
    status: 'ready',
    summary: 'What the section says.',
    why: 'You write about cities (Human geography).',
    item: { title: 'Urbanization', canonical_url: 'https://en.wikipedia.org/wiki/Urbanization', licence: null },
    segment: { heading: 'Causes', text: 'Short text.', section_anchor: 'Causes' },
    ...overrides,
  };
}

describe('the source line', () => {
  it('titles a section by article and heading, and the lead by article alone', () => {
    expect(cardTitle('Inflation', 'Causes')).toBe('Inflation: Causes');
    expect(cardTitle('Inflation', null)).toBe('Inflation');
  });

  it('links to the section, and the lead to the bare article', () => {
    expect(sectionLink('https://en.wikipedia.org/wiki/Inflation', 'Causes')).toBe(
      'https://en.wikipedia.org/wiki/Inflation#Causes',
    );
    expect(sectionLink('https://en.wikipedia.org/wiki/Inflation', null)).toBe(
      'https://en.wikipedia.org/wiki/Inflation',
    );
    // An anchor already on the stored URL is replaced rather than doubled.
    expect(sectionLink('https://en.wikipedia.org/wiki/Inflation#Old', 'Causes')).toBe(
      'https://en.wikipedia.org/wiki/Inflation#Causes',
    );
  });

  it('names CC BY-SA for Wikipedia and keeps a stored licence over it', () => {
    expect(licenceFor(null, 'https://en.wikipedia.org/wiki/Inflation')).toBe('CC BY-SA 4.0');
    expect(licenceFor('CC BY-NC-SA', 'https://ocw.mit.edu/x')).toBe('CC BY-NC-SA');
    expect(licenceFor(null, 'https://example.com/x')).toBeNull();
    expect(licenceFor(null, 'not a url')).toBeNull();
  });

  it('names the site the link goes to', () => {
    expect(siteName('https://en.wikipedia.org/wiki/Inflation')).toBe('Wikipedia');
    expect(siteName('https://www.example.com/x')).toBe('example.com');
  });
});

describe('folding the section', () => {
  it('shows a short section whole', () => {
    const split = splitForReading('One paragraph.\n\nAnother one.', 700);
    expect(split).toEqual({ shown: ['One paragraph.', 'Another one.'], rest: [], restMinutes: 0 });
  });

  it('shows whole paragraphs up to the limit and folds the rest', () => {
    const p = 'x'.repeat(300);
    const split = splitForReading([p, p, p, p].join('\n'), 700);
    expect(split.shown).toHaveLength(2);
    expect(split.rest).toHaveLength(2);
    expect(split.restMinutes).toBe(1);
  });

  it('does not fold away a line or two', () => {
    const split = splitForReading(['a'.repeat(600), 'b'.repeat(150)].join('\n'), 700);
    expect(split.rest).toEqual([]);
  });

  it('cuts one long paragraph at a sentence end and keeps the remainder behind the fold', () => {
    const sentence = 'This sentence is exactly fifty characters long ok. ';
    const text = sentence.repeat(40).trim();
    const split = splitForReading(text, 700);
    expect(split.shown).toHaveLength(1);
    expect(split.shown[0]!.endsWith('.')).toBe(true);
    expect(split.shown[0]!.length).toBeLessThanOrEqual(700);
    expect(split.shown[0]!.length + split.rest.join(' ').length + 1).toBe(text.length);
  });

  it('counts the minutes the rest takes', () => {
    const long = Array.from({ length: 10 }, () => 'word '.repeat(100).trim());
    const split = splitForReading(long.join('\n'), 700);
    // 1000 words, less the one paragraph shown: 900 at 230 a minute.
    expect(split.restMinutes).toBe(4);
  });
});

describe('turning a row into a card', () => {
  it('carries the title, why, summary, link and licence', () => {
    const card = toFeedCard(row())!;
    expect(card.title).toBe('Urbanization: Causes');
    expect(card.link).toBe('https://en.wikipedia.org/wiki/Urbanization#Causes');
    expect(card.licence).toBe('CC BY-SA 4.0');
    expect(card.shown).toEqual(['Short text.']);
  });

  it('shows nothing for a queued reading or a row missing its parts', () => {
    expect(toFeedCard(row({ reason: 'queued' }))).toBeNull();
    expect(toFeedCard(row({ summary: null }))).toBeNull();
    expect(toFeedCard(row({ why: null }))).toBeNull();
    expect(toFeedCard(row({ segment: null }))).toBeNull();
  });
});

describe('what each action may move', () => {
  it('opens only a card nobody has acted on', () => {
    expect(ACTION_FROM.opened).toEqual(['ready']);
  });

  it('lets save, dismiss and test follow an open, and nothing undo a dismissal', () => {
    for (const action of ['saved', 'dismissed', 'tested'] as const) {
      expect(ACTION_FROM[action]).toContain('ready');
      expect(ACTION_FROM[action]).toContain('opened');
      expect(ACTION_FROM[action]).not.toContain('dismissed');
      expect(ACTION_FROM[action]).not.toContain('tested');
    }
  });

  it('lets Test me and the swipes follow a Save, and not a second Save or a dismissal', () => {
    expect(ACTION_FROM.tested).toContain('saved');
    expect(ACTION_FROM.known).toContain('saved');
    expect(ACTION_FROM.saved).not.toContain('saved');
    expect(ACTION_FROM.dismissed).not.toContain('saved');
  });

  it('lets a card that came back be swiped again, and never moves a dismissed or tested one', () => {
    for (const swipe of SWIPES) {
      expect(ACTION_FROM[swipe]).toEqual(expect.arrayContaining(['ready', 'review', 'skipped']));
      expect(ACTION_FROM[swipe]).not.toContain('dismissed');
      expect(ACTION_FROM[swipe]).not.toContain('tested');
      expect(ACTION_FROM[swipe]).not.toContain('known');
    }
  });
});

describe('the feed', () => {
  it('appends a page without repeating a card already shown', () => {
    const a = { id: 'a' } as FeedCard;
    const b = { id: 'b' } as FeedCard;
    expect(appendCards([a], [a, b]).map((card) => card.id)).toEqual(['a', 'b']);
  });

  it('says more are being written only when the ready pool is low', () => {
    expect(feedEnd(3, 10)).toBe('writing');
    expect(feedEnd(14, 10)).toBe('passed');
  });
});
