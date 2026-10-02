import { describe, expect, it } from 'vitest';
import { firstParam, practiceHref, wantsPractice } from './href';

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

  it('is on for an old Practice Flow link with a focus or filter', () => {
    expect(wantsPractice({ track: 'abc' })).toBe(true);
    expect(wantsPractice({ goal: 'g1' })).toBe(true);
    expect(wantsPractice({ only: 'tracks' })).toBe(true);
  });

  it('is off for the feed', () => {
    expect(wantsPractice({})).toBe(false);
    expect(wantsPractice({ practice: '0' })).toBe(false);
  });
});

describe('firstParam', () => {
  it('takes the first of a repeated parameter', () => {
    expect(firstParam(['a', 'b'])).toBe('a');
    expect(firstParam('a')).toBe('a');
    expect(firstParam(undefined)).toBeUndefined();
  });
});
