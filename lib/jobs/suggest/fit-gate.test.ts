import { describe, expect, it } from 'vitest';
import { belowFitGate, DEFAULT_MIN_FIT_SCORE, readMinFitScore } from './fit-gate';

describe('belowFitGate', () => {
  const fit = (value: number) => ({ fit_score: { value, confidence: 0.9 } });

  it('holds back a role Jev scores under the minimum, and only then', () => {
    expect(belowFitGate(fit(22), 25)).toBe(true);
    expect(belowFitGate(fit(25), 25)).toBe(false);
    expect(belowFitGate(fit(57), 25)).toBe(false);
  });

  it('lets through a role with no fit score, and everything when the gate is off', () => {
    expect(belowFitGate({}, 25)).toBe(false);
    expect(belowFitGate(null, 25)).toBe(false);
    expect(belowFitGate(fit(2), 0)).toBe(false);
  });
});

describe('readMinFitScore', () => {
  it('reads the stored setting, kept within 0 to 100', () => {
    expect(readMinFitScore(40)).toBe(40);
    expect(readMinFitScore('30')).toBe(30);
    expect(readMinFitScore(150)).toBe(100);
    expect(readMinFitScore(null)).toBe(DEFAULT_MIN_FIT_SCORE);
  });
});
