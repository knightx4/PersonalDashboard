import { describe, expect, it } from 'vitest';
import { IDEA_LIMIT, ideaAllowance, ideaCapRefusal } from './rate';

const now = new Date('2026-10-15T12:00:00Z').getTime();
/** A filing `hours` ago. */
const ago = (hours: number) => now - hours * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

describe('ideaAllowance', () => {
  it('allows the first idea of the day', () => {
    expect(ideaAllowance([], now)).toEqual({ allowed: true, filed: 0, freeAt: null });
  });

  it('allows the third', () => {
    expect(ideaAllowance([ago(1), ago(5)], now)).toEqual({ allowed: true, filed: 2, freeAt: null });
  });

  it('refuses the fourth', () => {
    const allowance = ideaAllowance([ago(1), ago(5), ago(20)], now);
    expect(allowance.allowed).toBe(false);
    expect(allowance.filed).toBe(IDEA_LIMIT);
  });

  it('frees the cap a day after the oldest of the three', () => {
    const allowance = ideaAllowance([ago(1), ago(5), ago(20)], now);
    expect(allowance.freeAt).toBe(ago(20) + DAY_MS);
  });

  it('ignores a filing older than a day', () => {
    expect(ideaAllowance([ago(25), ago(30), ago(2)], now)).toEqual({ allowed: true, filed: 1, freeAt: null });
  });

  it('counts the three most recent when more were filed', () => {
    const allowance = ideaAllowance([ago(1), ago(2), ago(3), ago(10)], now);
    expect(allowance.allowed).toBe(false);
    expect(allowance.freeAt).toBe(ago(3) + DAY_MS);
  });

  it('reads an unordered list the same as a sorted one', () => {
    expect(ideaAllowance([ago(20), ago(1), ago(5)], now)).toEqual(ideaAllowance([ago(1), ago(5), ago(20)], now));
  });
});

describe('ideaCapRefusal', () => {
  it('says how many were filed and how long the wait is, in hours when long', () => {
    const line = ideaCapRefusal(ideaAllowance([ago(1), ago(5), ago(20)], now), now);
    expect(line).toBe(
      '3 ideas already filed by sessions in the last day, which is the cap (3 a day). ' +
        'The next can be filed in 4h.',
    );
  });

  it('says minutes when the wait is short, and never counts down to zero', () => {
    expect(ideaCapRefusal(ideaAllowance([ago(1), ago(2), ago(23.5)], now), now)).toContain('in 30m');
    expect(ideaCapRefusal(ideaAllowance([ago(1), ago(2), ago(23.9999)], now), now)).toContain('in 1m');
  });
});
