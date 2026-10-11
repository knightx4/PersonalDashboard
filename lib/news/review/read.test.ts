import { describe, expect, it } from 'vitest';
import {
  readReviewDay,
  readReviewItems,
  REVIEW_TIME,
  reviewDayLabel,
  reviewDayShort,
  reviewHref,
  reviewNav,
  todayStillToCome,
} from './read';

describe('readReviewDay', () => {
  it('takes a real calendar day', () => {
    expect(readReviewDay('2026-10-06')).toBe('2026-10-06');
  });

  it('refuses anything else', () => {
    expect(readReviewDay(undefined)).toBeNull();
    expect(readReviewDay('2026-02-30')).toBeNull();
    expect(readReviewDay('6 Oct')).toBeNull();
    expect(readReviewDay('2026-10-06; drop')).toBeNull();
  });
});

describe('readReviewItems', () => {
  it('keeps the order and the local mark', () => {
    const items = readReviewItems([
      { issue_id: 'a', story_index: 2, headline: ' Strike off ', line: ' The strike is off. ', sources: 3 },
      { issue_id: 'b', story_index: 0, headline: 'Lanes', line: 'Cycle lanes approved.', sources: 1, local: true },
    ]);
    expect(items).toEqual([
      { issue_id: 'a', story_index: 2, headline: 'Strike off', line: 'The strike is off.', sources: 3 },
      { issue_id: 'b', story_index: 0, headline: 'Lanes', line: 'Cycle lanes approved.', sources: 1, local: true },
    ]);
  });

  it('leaves out an entry with nowhere to open or no line', () => {
    expect(
      readReviewItems([
        { story_index: 1, line: 'No issue' },
        { issue_id: 'a', story_index: -1, line: 'Bad index' },
        { issue_id: 'a', story_index: 1.5, line: 'Bad index' },
        { issue_id: 'a', story_index: 1, line: '  ' },
        null,
        'text',
      ]),
    ).toEqual([]);
    expect(readReviewItems({ not: 'an array' })).toEqual([]);
  });

  it('reads a missing source count as one newsletter', () => {
    expect(readReviewItems([{ issue_id: 'a', story_index: 0, line: 'x' }])[0]?.sources).toBe(1);
  });
});

describe('reviewNav', () => {
  const days = ['2026-10-06', '2026-10-05', '2026-10-02'];

  it('opens on the latest, with only the back arrow live', () => {
    expect(reviewNav(days, null)).toEqual({ day: '2026-10-06', earlier: '2026-10-05', later: null });
  });

  it('skips days with no review', () => {
    expect(reviewNav(days, '2026-10-05')).toEqual({
      day: '2026-10-05',
      earlier: '2026-10-02',
      later: '2026-10-06',
    });
    expect(reviewNav(days, '2026-10-02')).toEqual({ day: '2026-10-02', earlier: null, later: '2026-10-05' });
  });

  it('falls back to the latest for a day that has none', () => {
    expect(reviewNav(days, '2026-10-04').day).toBe('2026-10-06');
  });

  it('has nothing to show before the first review', () => {
    expect(reviewNav([], null)).toEqual({ day: null, earlier: null, later: null });
  });
});

describe('labels and addresses', () => {
  it('names the latest day by the bare address', () => {
    expect(reviewHref('2026-10-06', '2026-10-06')).toBe('/news/review');
    expect(reviewHref('2026-10-05', '2026-10-06')).toBe('/news/review?day=2026-10-05');
  });

  it('writes the day out, with the year only when it is not this one', () => {
    const now = new Date('2026-10-06T19:00:00Z');
    expect(reviewDayLabel('2026-10-06', now)).toBe('Tuesday 6 October');
    expect(reviewDayLabel('2025-12-31', now)).toBe('Wednesday 31 December 2025');
    expect(reviewDayShort('2026-10-05')).toBe('Mon 5 Oct');
  });

  it('says the hour on the twelve-hour clock', () => {
    expect(REVIEW_TIME).toBe('8:00 PM');
  });

  it('knows whether today’s review is still to come in the person’s zone', () => {
    expect(todayStillToCome('Europe/London', new Date('2026-10-06T18:00:00Z'))).toBe(true);
    expect(todayStillToCome('Europe/London', new Date('2026-10-06T19:30:00Z'))).toBe(false);
  });
});
