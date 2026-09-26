import { describe, expect, it } from 'vitest';
import { goalsWaitingText, jobEventLabel, mergeUpdates, whenLabel, type Update } from './home-model';

const update = (key: string, at: string): Update => ({
  key,
  module: 'jobs',
  at,
  text: key,
  detail: null,
  href: null,
});

describe('jobEventLabel', () => {
  it('says what happened in words, with the company in it', () => {
    expect(jobEventLabel('recruiter_reply', 'Acme')).toBe('Acme replied');
    expect(jobEventLabel('rejection', 'Acme')).toBe('Acme said no');
    expect(jobEventLabel('interview_scheduled', 'Acme')).toBe('Interview booked with Acme');
  });

  it('falls back to the kind with spaces for one it does not know', () => {
    expect(jobEventLabel('something_new', 'Acme')).toBe('Acme: something new');
  });
});

describe('mergeUpdates', () => {
  it('puts every source in one list, newest first, capped', () => {
    const merged = mergeUpdates(
      [
        [update('a', '2026-09-24T10:00:00Z'), update('b', '2026-09-26T09:00:00Z')],
        [update('c', '2026-09-25T12:00:00Z')],
      ],
      2,
    );
    expect(merged.map((u) => u.key)).toEqual(['b', 'c']);
  });
});

describe('whenLabel', () => {
  const now = new Date('2026-09-26T15:00:00Z');

  it('counts minutes and hours on the same day', () => {
    expect(whenLabel('2026-09-26T14:50:00Z', now, 'UTC')).toBe('10m ago');
    expect(whenLabel('2026-09-26T12:00:00Z', now, 'UTC')).toBe('3h ago');
  });

  it('says yesterday, then the weekday', () => {
    expect(whenLabel('2026-09-25T20:00:00Z', now, 'UTC')).toBe('Yesterday');
    expect(whenLabel('2026-09-24T20:00:00Z', now, 'UTC')).toBe('Thu');
  });

  it('reads the day in the reader zone, not UTC', () => {
    // 02:00 UTC on the 26th is still the 25th in New York.
    expect(whenLabel('2026-09-26T02:00:00Z', now, 'America/New_York')).toBe('Yesterday');
  });
});

describe('goalsWaitingText', () => {
  it('is null when nothing waits', () => {
    expect(goalsWaitingText([])).toBeNull();
  });

  it('counts by the groups the Goals page uses', () => {
    expect(
      goalsWaitingText([{ kind: 'question' }, { kind: 'flag' }, { kind: 'plan' }, { kind: 'review' }]),
    ).toEqual({ text: '2 to decide, 1 to approve, 1 to read on your goals', decide: 2 });
  });
});
