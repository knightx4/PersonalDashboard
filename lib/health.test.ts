import { describe, expect, it } from 'vitest';
import { CLOSING_DAYS, HEALTH_ORDER, HEALTH_STATES, deadlineHealth } from './health';
import { DUE_SOON_DAYS } from './returns/deadline';

describe('deadlineHealth', () => {
  it('has no state without a window to divide by', () => {
    expect(deadlineHealth(5, null)).toBeNull();
    expect(deadlineHealth(5, 0)).toBeNull();
    expect(deadlineHealth(5, -30)).toBeNull();
    expect(deadlineHealth(null, 30)).toBeNull();
  });

  it('reads either side of the overdue boundary', () => {
    expect(deadlineHealth(-1, 30)).toBe('overdue');
    expect(deadlineHealth(0, 30)).toBe('closing');
  });

  it('reads either side of the closing boundary', () => {
    expect(deadlineHealth(CLOSING_DAYS, 30)).toBe('closing');
    expect(deadlineHealth(CLOSING_DAYS + 1, 30)).toBe('at-risk');
  });

  it('reads either side of the at-risk boundary', () => {
    expect(deadlineHealth(DUE_SOON_DAYS, 30)).toBe('at-risk');
    expect(deadlineHealth(DUE_SOON_DAYS + 1, 30)).toBe('on-track');
  });
});

describe('HEALTH_STATES', () => {
  it('gives every state a word and a fill', () => {
    for (const state of HEALTH_ORDER) {
      expect(HEALTH_STATES[state].label).toBeTruthy();
      expect(HEALTH_STATES[state].fill).toBeTruthy();
    }
  });
});
