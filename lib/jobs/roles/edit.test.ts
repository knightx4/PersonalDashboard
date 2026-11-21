import { describe, expect, it } from 'vitest';
import { aiScoreError, experienceYearsError } from './edit';

describe('experienceYearsError', () => {
  it('accepts a range, an open end and nothing', () => {
    expect(experienceYearsError(3, 5)).toBeNull();
    expect(experienceYearsError(5, null)).toBeNull();
    expect(experienceYearsError(null, 7)).toBeNull();
    expect(experienceYearsError(null, null)).toBeNull();
    expect(experienceYearsError(4, 4)).toBeNull();
  });

  it('refuses a negative, a fraction and a maximum below the minimum', () => {
    expect(experienceYearsError(-1, null)).toMatch(/negative/);
    expect(experienceYearsError(2.5, null)).toMatch(/whole/);
    expect(experienceYearsError(5, 3)).toMatch(/below/);
    expect(experienceYearsError(null, 61)).toMatch(/60/);
  });
});

describe('aiScoreError', () => {
  it('takes a whole number from 0 to 100, or null', () => {
    expect(aiScoreError(null)).toBeNull();
    expect(aiScoreError(0)).toBeNull();
    expect(aiScoreError(100)).toBeNull();
    expect(aiScoreError(101)).toMatch(/0 to 100/);
    expect(aiScoreError(-1)).toMatch(/0 to 100/);
    expect(aiScoreError(5.5)).toMatch(/0 to 100/);
    expect(aiScoreError(Number.NaN)).toMatch(/0 to 100/);
  });
});
