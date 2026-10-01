import { describe, expect, it } from 'vitest';
import { clockOf, parseWatchRequest, watchPlan } from './start';

/** Starting a watch from what Dash was asked (plan #1296): the pure half. */

const NOW = new Date('2026-10-01T14:00:00Z');
const BASE = { title: 'Show', url: 'https://example.com/e', below: 200, ends_on: '2026-10-18' };

describe('clockOf', () => {
  it('reads a time of day as HH:MM', () => {
    expect(clockOf('9:00')).toBe('09:00');
    expect(clockOf('21:30:00')).toBe('21:30');
    expect(clockOf('24:00')).toBeNull();
    expect(clockOf('9am')).toBeNull();
  });
});

describe('parseWatchRequest', () => {
  it('places the end in the person\'s zone, at the end of the day unless a time was said', () => {
    const tokyo = parseWatchRequest(BASE, { now: NOW, timezone: 'Asia/Tokyo' });
    expect(tokyo.ok && tokyo.value.endsAt).toBe('2026-10-18T14:59:00.000Z');
    const timed = parseWatchRequest({ ...BASE, ends_time: '20:00' }, { now: NOW, timezone: 'UTC' });
    expect(timed.ok && timed.value.endsAt).toBe('2026-10-18T20:00:00.000Z');
  });

  it('drops repeated report times and sorts them', () => {
    const parsed = parseWatchRequest({ ...BASE, report_times: ['18:00', '9:00', '09:00'] }, { now: NOW, timezone: 'UTC' });
    expect(parsed.ok && parsed.value.reportTimes).toEqual(['09:00', '18:00']);
  });

  it('refuses more report times than the table takes', () => {
    const times = ['1:00', '2:00', '3:00', '4:00', '5:00', '6:00', '7:00'];
    const parsed = parseWatchRequest({ ...BASE, report_times: times }, { now: NOW, timezone: 'UTC' });
    expect(parsed).toEqual({ ok: false, error: 'A watch takes at most 6 report times.' });
  });

  it('refuses an address with a login in it', () => {
    const parsed = parseWatchRequest({ ...BASE, url: 'https://me:pw@example.com/' }, { now: NOW, timezone: 'UTC' });
    expect(parsed.ok).toBe(false);
  });
});

// reportTimeLabel keeps a time on one line with a no-break space.
describe('watchPlan', () => {
  it('says what the watch will do and when it stops', () => {
    expect(watchPlan({ below: 200, currency: 'USD', reportTimes: ['09:00', '18:00'] }, 'Sunday 18 October')).toBe(
      ', with a push when it goes under $200 and a report at 9:00\u00a0AM and 6:00\u00a0PM, until Sunday 18 October',
    );
    expect(watchPlan({ below: null, currency: null, reportTimes: ['09:00'] }, 'Sunday 18 October')).toBe(
      ', with a report at 9:00\u00a0AM, until Sunday 18 October',
    );
  });
});
