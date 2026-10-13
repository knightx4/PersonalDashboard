import { describe, expect, it } from 'vitest';
import { ease, lightingUp, litLine, recentlyLit } from './lights-up';

const NOW = new Date('2026-10-13T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

function idea(id: string, setHoursAgo: number | null, strength = 0.8) {
  return {
    id,
    strength,
    haze: 0,
    state: 'known' as const,
    stateRow:
      setHoursAgo === null
        ? null
        : {
            state: 'known' as const,
            established: 'tested' as const,
            tested_at: hoursAgo(setHoursAgo),
            declared_at: null,
            review_interval_days: null,
          },
  };
}

describe('recentlyLit', () => {
  it('keeps the ideas set in the last two days, newest first', () => {
    const got = recentlyLit([idea('old', 72), idea('a', 30), idea('b', 2), idea('none', null)], NOW);
    expect(got.map((i) => i.id)).toEqual(['b', 'a']);
  });
  it('leaves out an idea with no strength left', () => {
    expect(recentlyLit([idea('faded', 1, 0)], NOW)).toEqual([]);
  });
  it('takes at most three', () => {
    const many = [1, 2, 3, 4, 5].map((h) => idea(`i${h}`, h));
    expect(recentlyLit(many, NOW).map((i) => i.id)).toEqual(['i1', 'i2', 'i3']);
  });
});

describe('lightingUp', () => {
  const ideas = [idea('a', 1, 0.8), idea('b', 100, 0.5)];
  it('starts dark and ends at the strength, leaving the rest alone', () => {
    const ids = new Set(['a']);
    expect(lightingUp(ideas, ids, 0).get('a')!.strength).toBe(0);
    expect(lightingUp(ideas, ids, 1).get('a')!.strength).toBeCloseTo(0.8);
    expect(lightingUp(ideas, ids, 0.3).get('b')!.strength).toBe(0.5);
  });
});

describe('ease', () => {
  it('runs from 0 to 1 and rises throughout', () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(0.6)).toBeGreaterThan(ease(0.3));
  });
});

describe('litLine', () => {
  it('names one or several ideas', () => {
    expect(litLine([])).toBeNull();
    expect(litLine(['A'])).toBe('“A” lit in the last two days.');
    expect(litLine(['A', 'B', 'C'])).toBe('“A”, “B” and “C” lit in the last two days.');
  });
});
