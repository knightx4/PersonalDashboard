import { describe, expect, it } from 'vitest';
import { claimWordingLine, lastAnsweredLine, lastCheckedLine } from './last-answered';

/**
 * The line is about days in the account's timezone, not about hours elapsed,
 * so the cases worth testing are the ones where an instant falls on a
 * different day depending on where you are standing.
 */

const NOW = new Date('2026-09-13T09:00:00Z');

describe('when the last question was answered', () => {
  it('says nothing when nothing has ever been answered', () => {
    expect(lastAnsweredLine(null, NOW, 'Europe/London')).toBeNull();
  });

  it('says today when the last one was today', () => {
    expect(lastAnsweredLine('2026-09-13T07:30:00Z', NOW, 'Europe/London')).toBe(
      'You answered one today.',
    );
  });

  it('gives the date when it was another day', () => {
    expect(lastAnsweredLine('2026-09-11T18:00:00Z', NOW, 'Europe/London')).toBe(
      'The last one was on 11 September.',
    );
  });

  it('reads the day in the account timezone rather than UTC', () => {
    // Late on the 12th in London is already the morning of the 13th in Tokyo,
    // and the 13th is today in both places.
    expect(lastAnsweredLine('2026-09-12T22:00:00Z', NOW, 'Asia/Tokyo')).toBe(
      'You answered one today.',
    );
    expect(lastAnsweredLine('2026-09-12T22:00:00Z', NOW, 'Europe/London')).toBe(
      'The last one was on 12 September.',
    );
  });

  it('adds the year when it was not this one', () => {
    expect(lastAnsweredLine('2025-03-14T10:00:00Z', NOW, 'Europe/London')).toBe(
      'The last one was on 14 March 2025.',
    );
  });
});

describe('when a claim was last checked', () => {
  it('says nothing for a claim nobody has been asked about', () => {
    expect(lastCheckedLine(null, NOW, 'Europe/London')).toBeNull();
  });

  it('says today when it was checked today', () => {
    expect(lastCheckedLine('2026-09-13T07:30:00Z', NOW, 'Europe/London')).toBe(
      'Last checked today.',
    );
  });

  it('gives the date when it was earlier this year', () => {
    expect(lastCheckedLine('2026-03-14T10:00:00Z', NOW, 'Europe/London')).toBe(
      'Last checked on 14 March.',
    );
  });

  it('adds the year when it was an earlier one', () => {
    expect(lastCheckedLine('2025-03-14T10:00:00Z', NOW, 'Europe/London')).toBe(
      'Last checked on 14 March 2025.',
    );
  });

  it('reads the day in the account timezone rather than UTC', () => {
    expect(lastCheckedLine('2026-09-12T22:00:00Z', NOW, 'Asia/Tokyo')).toBe('Last checked today.');
    expect(lastCheckedLine('2026-09-12T22:00:00Z', NOW, 'Europe/London')).toBe(
      'Last checked on 12 September.',
    );
  });
});

describe('whose words a claim is in', () => {
  it('says the app wrote it when nobody has rewritten it', () => {
    expect(claimWordingLine(null, NOW, 'Europe/London')).toBe('In the app\u2019s words.');
  });

  it('says today when it was rewritten today', () => {
    expect(claimWordingLine('2026-09-13T07:30:00Z', NOW, 'Europe/London')).toBe(
      'In your words, written today.',
    );
  });

  it('gives the date when it was rewritten earlier', () => {
    expect(claimWordingLine('2026-03-14T10:00:00Z', NOW, 'Europe/London')).toBe(
      'In your words, written on 14 March.',
    );
  });

  it('still says whose words it is when the date will not parse', () => {
    expect(claimWordingLine('not a date', NOW, 'Europe/London')).toBe('In your words.');
  });
});
