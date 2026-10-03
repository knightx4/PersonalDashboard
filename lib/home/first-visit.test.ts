import { describe, expect, it } from 'vitest';
import { firstToday, HOME_ARRIVED_COOKIE, seenCookie } from './first-visit';

describe('firstToday', () => {
  it('is the first visit when no day has been seen', () => {
    expect(firstToday(undefined, '2026-10-03')).toBe(true);
    expect(firstToday(null, '2026-10-03')).toBe(true);
    expect(firstToday('', '2026-10-03')).toBe(true);
  });

  it('is the first visit when the day seen was an earlier one', () => {
    expect(firstToday('2026-10-02', '2026-10-03')).toBe(true);
  });

  it('is a later visit once today has been seen', () => {
    expect(firstToday('2026-10-03', '2026-10-03')).toBe(false);
  });
});

describe('seenCookie', () => {
  it('records the day for the whole site, for two days', () => {
    expect(seenCookie(HOME_ARRIVED_COOKIE, '2026-10-03')).toBe(
      'home_arrived=2026-10-03; path=/; max-age=172800; samesite=lax',
    );
  });
});
