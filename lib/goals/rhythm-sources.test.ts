import { describe, expect, it } from 'vitest';
import {
  calendarDays,
  countIn,
  matchPieces,
  rhythmSource,
  spanOf,
  titleMatches,
} from './rhythm-sources';

describe('titleMatches', () => {
  it('matches any piece of the match text, ignoring case', () => {
    expect(titleMatches('Community Board 6 meeting', 'urbanism|community board')).toBe(true);
    expect(titleMatches('Urbanism walk', 'urbanism|community board')).toBe(true);
    expect(titleMatches('Dinner with Nick', 'urbanism|community board')).toBe(false);
  });

  it('matches nothing on an empty match text or empty pieces', () => {
    expect(titleMatches('Anything', '')).toBe(false);
    expect(titleMatches('Anything', ' | ')).toBe(false);
    expect(matchPieces(' Urbanism |  | Board ')).toEqual(['urbanism', 'board']);
  });
});

describe('rhythmSource', () => {
  it('reads the two columns, and calendar only with a match text', () => {
    expect(rhythmSource('applications', null)).toEqual({ kind: 'applications', match: null });
    expect(rhythmSource('calendar', 'urbanism')).toEqual({ kind: 'calendar', match: 'urbanism' });
    expect(rhythmSource('calendar', '  ')).toBeNull();
    expect(rhythmSource('posts', null)).toBeNull();
    expect(rhythmSource(null, null)).toBeNull();
  });
});

describe('countIn', () => {
  const week = { startsOn: '2026-09-28', endsOn: '2026-10-05' };

  it('counts the days in the period, none after today', () => {
    const days = ['2026-09-27', '2026-09-28', '2026-10-01', '2026-10-03', '2026-10-05'];
    expect(countIn(week, days, '2026-10-04')).toBe(3);
    expect(countIn(week, days, '2026-10-01')).toBe(2);
  });
});

describe('spanOf and calendarDays', () => {
  it('covers every period asked for', () => {
    expect(
      spanOf([
        { startsOn: '2026-09-21', endsOn: '2026-09-28' },
        { startsOn: '2026-09-14', endsOn: '2026-09-21' },
      ]),
    ).toEqual({ startsOn: '2026-09-14', endsOn: '2026-09-28' });
    expect(spanOf([])).toBeNull();
  });

  it('keeps the days of the matching events', () => {
    const events = [
      { title: 'Urbanism meetup', day: '2026-09-29' },
      { title: 'Dinner', day: '2026-09-30' },
    ];
    expect(calendarDays(events, 'urbanism')).toEqual(['2026-09-29']);
  });
});
