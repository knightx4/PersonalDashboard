import { describe, expect, it } from 'vitest';
import { experienceYearsError } from './edit';

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
