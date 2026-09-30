import { describe, expect, it } from 'vitest';
import { NO_PREFERENCES, preferenceLines, preferenceMisses, preferenceState, readPreferences } from './preferences';

const prefs = readPreferences({
  home_location: ' New York ',
  workplace_preferences: ['remote', 'hybrid', 'nonsense'],
  salary_floor_cents: 12_000_000,
  company_stages: ['growth'],
});

describe('readPreferences', () => {
  it('reads the columns and drops anything the lists do not name', () => {
    expect(prefs).toEqual({
      homeLocation: 'New York',
      workplaces: ['remote', 'hybrid'],
      salaryFloorCents: 12_000_000,
      companyStages: ['growth'],
    });
    expect(readPreferences(null)).toEqual(NO_PREFERENCES);
  });
});

describe('preferenceLines and preferenceState', () => {
  it('say nothing when nothing is set', () => {
    expect(preferenceLines(NO_PREFERENCES)).toEqual([]);
    expect(preferenceState(NO_PREFERENCES)).toBeNull();
  });

  it('name each preference set', () => {
    expect(preferenceLines(prefs)).toEqual([
      'Where they live or want to work: New York',
      'How they will work: remote or hybrid',
      'Lowest base pay worth applying for: 120,000 a year',
      'Company stages they want: growth-stage startup',
    ]);
    expect(preferenceState(prefs)).toMatchObject({ lowest_base_pay_per_year: 120000 });
  });
});

describe('preferenceMisses', () => {
  it('flags pay below the floor and a workplace not asked for', () => {
    expect(preferenceMisses({ compMaxCents: 10_000_000, workMode: 'onsite' }, prefs)).toEqual([
      'Pay below your floor',
      'On-site, not how you want to work',
    ]);
  });

  it('misses nothing a posting does not state', () => {
    expect(preferenceMisses({ compMaxCents: null, workMode: null }, prefs)).toEqual([]);
    expect(preferenceMisses({ compMaxCents: 15_000_000, workMode: 'remote' }, prefs)).toEqual([]);
  });

  it("falls back to Jev's workplace answer", () => {
    expect(preferenceMisses({ compMaxCents: null, workMode: null, workplaceAnswer: 'on_site' }, prefs)).toHaveLength(1);
  });
});
