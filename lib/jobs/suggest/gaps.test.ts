import { describe, expect, it } from 'vitest';
import { setupGaps, type SetupState } from './gaps';
import { NO_PREFERENCES } from './preferences';

const complete: SetupState = {
  preferences: { ...NO_PREFERENCES, homeLocation: 'New York City' },
  targetTitles: ['Strategic Finance'],
  goalEntries: 2,
  hasResume: true,
  jevOn: true,
  minFitScore: 25,
};

describe('setupGaps', () => {
  it('finds nothing missing in a complete setup', () => {
    expect(setupGaps(complete)).toEqual([]);
  });

  it('names each missing piece and what it changes', () => {
    const gaps = setupGaps({
      ...complete,
      preferences: NO_PREFERENCES,
      targetTitles: [],
      goalEntries: 0,
      hasResume: false,
    });
    expect(gaps.map((gap) => gap.key)).toEqual(['home', 'titles', 'goals', 'resume']);
    expect(gaps[0].text).toContain('from anywhere');
  });

  it('says when scoring is off, and when the fit minimum lets everything through', () => {
    expect(setupGaps({ ...complete, jevOn: false }).map((gap) => gap.key)).toEqual(['jev']);
    expect(setupGaps({ ...complete, minFitScore: 0 }).map((gap) => gap.key)).toEqual(['fit']);
  });
});
