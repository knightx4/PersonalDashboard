import { describe, expect, it } from 'vitest';
import {
  aimProgressLine,
  jobWeekLine,
  toLink,
  weekInstants,
  type LinkedAim,
} from '@/lib/goals/links';

const aim = (over: Partial<LinkedAim> = {}): LinkedAim => ({
  linkId: 'l1',
  aimId: 'a1',
  name: 'Urban planning basics',
  archived: false,
  level3: null,
  cardsRead: 0,
  cardsSaved: 0,
  ...over,
});

describe('weekInstants', () => {
  it('runs Monday to Monday at midnight in the account zone', () => {
    // Thursday 24 September 2026; New York is four hours behind UTC then.
    expect(weekInstants('2026-09-24', 'America/New_York')).toEqual({
      from: '2026-09-21T04:00:00.000Z',
      to: '2026-09-28T04:00:00.000Z',
    });
  });

  it('keeps a Sunday in the week that began the Monday before', () => {
    expect(weekInstants('2026-09-27', 'UTC').from).toBe('2026-09-21T00:00:00.000Z');
  });
});

describe('aimProgressLine', () => {
  it('counts the cards read and saved for an open subject', () => {
    expect(aimProgressLine(aim())).toBe('No cards read yet');
    expect(aimProgressLine(aim({ cardsRead: 1 }))).toBe('1 card read');
    expect(aimProgressLine(aim({ cardsRead: 5, cardsSaved: 2 }))).toBe('5 cards read, 2 saved');
  });

  it('gives the Level 3 list its claimed and tested articles', () => {
    expect(aimProgressLine(aim({ level3: { claimed: 40, tested: 12, total: 1000 } }))).toBe(
      '40 of 1000 articles claimed, 12 tested',
    );
  });

  it('says when the aim has left Learn or been archived there', () => {
    expect(aimProgressLine(aim({ name: null }))).toBe('No longer in Learn');
    expect(aimProgressLine(aim({ cardsRead: 3, archived: true }))).toBe(
      '3 cards read. Archived in Learn',
    );
  });
});

describe('jobWeekLine', () => {
  it('says the week in applications and interviews', () => {
    expect(jobWeekLine({ applied: 3, interviews: 1 })).toBe(
      'This week: 3 applications sent, 1 interview',
    );
    expect(jobWeekLine({ applied: 1, interviews: 0 })).toBe(
      'This week: 1 application sent, 0 interviews',
    );
  });
});

describe('toLink', () => {
  it('reads a row and skips a kind it does not know', () => {
    expect(toLink({ id: 'l', item_id: 'g', kind: 'job_search', target_id: null })).toEqual({
      id: 'l',
      itemId: 'g',
      kind: 'job_search',
      targetId: null,
    });
    expect(toLink({ id: 'l', item_id: 'g', kind: 'book', target_id: 'x' })).toBeNull();
  });
});
