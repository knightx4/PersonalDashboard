import { describe, expect, it } from 'vitest';
import { IDEA_LIMIT, ideaAllowance, ideaCapRefusal } from './rate';

const now = new Date('2026-09-17T12:00:00Z').getTime();
/** A filing `minutes` ago. */
const ago = (minutes: number) => now - minutes * 60_000;

describe('ideaAllowance', () => {
  it('allows the first idea of the hour', () => {
    expect(ideaAllowance([], now)).toEqual({ allowed: true, filed: 0, freeAt: null });
  });

  it('allows the second', () => {
    expect(ideaAllowance([ago(10)], now)).toEqual({ allowed: true, filed: 1, freeAt: null });
  });

  it('refuses the third', () => {
    const allowance = ideaAllowance([ago(10), ago(40)], now);
    expect(allowance.allowed).toBe(false);
    expect(allowance.filed).toBe(IDEA_LIMIT);
  });

  it('frees the cap an hour after the older of the two', () => {
    const allowance = ideaAllowance([ago(10), ago(40)], now);
    expect(allowance.freeAt).toBe(ago(40) + 60 * 60_000);
  });

  it('ignores a filing older than the window', () => {
    expect(ideaAllowance([ago(61), ago(90), ago(5)], now)).toEqual({
      allowed: true,
      filed: 1,
      freeAt: null,
    });
  });

  it('counts the two most recent when more were filed', () => {
    const allowance = ideaAllowance([ago(5), ago(20), ago(50)], now);
    expect(allowance.allowed).toBe(false);
    expect(allowance.freeAt).toBe(ago(20) + 60 * 60_000);
  });

  it('reads an unordered list the same as a sorted one', () => {
    expect(ideaAllowance([ago(40), ago(10)], now)).toEqual(ideaAllowance([ago(10), ago(40)], now));
  });
});

describe('ideaCapRefusal', () => {
  it('says how many were filed and how long the wait is', () => {
    const line = ideaCapRefusal(ideaAllowance([ago(10), ago(40)], now), now);
    expect(line).toBe(
      '2 ideas already filed in the last hour, which is the cap (2 an hour from a session). ' +
        'The next can be filed in 20m.',
    );
  });

  it('never counts the wait down to zero', () => {
    const line = ideaCapRefusal(ideaAllowance([ago(59.99), ago(59.99)], now), now);
    expect(line).toContain('in 1m');
  });
});
