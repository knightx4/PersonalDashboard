import { describe, expect, it } from 'vitest';
import { firstParam, nowHref, practiceHref, subjectClipsHref, wantsPractice } from './href';

describe('subjectClipsHref', () => {
  it('opens the player under the subject', () => {
    expect(subjectClipsHref('abc')).toBe('/learn/s/abc/clips');
  });
});

describe('practiceHref', () => {
  it('opens Now with the Practice only switch on', () => {
    expect(practiceHref()).toBe('/learn/now?practice=1');
  });

  it('carries a track, a goal and a filter', () => {
    expect(practiceHref({ track: 'abc' })).toBe('/learn/now?practice=1&track=abc');
    expect(practiceHref({ goal: 'g1' })).toBe('/learn/now?practice=1&goal=g1');
    expect(practiceHref({ only: 'goals' })).toBe('/learn/now?practice=1&only=goals');
  });

  it('leaves out what is empty', () => {
    expect(practiceHref({ track: null, goal: '', only: undefined })).toBe('/learn/now?practice=1');
  });
});

describe('wantsPractice', () => {
  it('is on with the switch', () => {
    expect(wantsPractice({ practice: '1' })).toBe(true);
  });

  it('is on for an old Practice Flow link with a goal or filter', () => {
    expect(wantsPractice({ goal: 'g1' })).toBe(true);
    expect(wantsPractice({ only: 'tracks' })).toBe(true);
  });

  it('is off for the feed', () => {
    expect(wantsPractice({})).toBe(false);
    expect(wantsPractice({ practice: '0' })).toBe(false);
  });

  it('is off for one subject\'s feed, and on when the switch keeps the subject', () => {
    expect(wantsPractice({ track: 'abc' })).toBe(false);
    expect(wantsPractice({ practice: '1', track: 'abc' })).toBe(true);
  });
});

describe('nowHref', () => {
  it('opens the feed, narrowed to a subject when one is given', () => {
    expect(nowHref()).toBe('/learn/now');
    expect(nowHref(null)).toBe('/learn/now');
    expect(nowHref('abc')).toBe('/learn/now?track=abc');
  });
});

describe('firstParam', () => {
  it('takes the first of a repeated parameter', () => {
    expect(firstParam(['a', 'b'])).toBe('a');
    expect(firstParam('a')).toBe('a');
    expect(firstParam(undefined)).toBeUndefined();
  });
});
