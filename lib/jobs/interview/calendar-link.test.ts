import { describe, expect, it } from 'vitest';
import { interviewCalendarHref } from './calendar-link';

describe('interviewCalendarHref', () => {
  it('opens a Google invite as its event, on the calendar it arrived in', () => {
    const href = interviewCalendarHref({
      icsUid: 'abc123def@google.com',
      scheduledAt: '2026-10-07T15:00:00Z',
      calendarEmail: 'me@example.com',
      timezone: 'America/New_York',
    });
    const eid = new URL(href!).searchParams.get('eid')!;
    expect(href).toMatch(/^https:\/\/calendar\.google\.com\/calendar\/event\?eid=/);
    expect(Buffer.from(eid, 'base64').toString('utf8')).toBe('abc123def me@example.com');
    expect(eid.endsWith('=')).toBe(false);
  });

  it('opens the day of an invite that did not come from Google', () => {
    expect(
      interviewCalendarHref({
        icsUid: '040000008200E00074C5B7101A82E008@outlook.com',
        scheduledAt: '2026-10-07T02:00:00Z',
        calendarEmail: 'me@example.com',
        timezone: 'America/New_York',
      }),
    ).toBe('https://calendar.google.com/calendar/r/day/2026/10/6?authuser=me%40example.com');
  });

  it('opens the day when the mailbox is not known', () => {
    expect(
      interviewCalendarHref({
        icsUid: 'abc123def@google.com',
        scheduledAt: '2026-10-07T15:00:00Z',
        calendarEmail: null,
        timezone: 'UTC',
      }),
    ).toBe('https://calendar.google.com/calendar/r/day/2026/10/7');
  });

  it('has nowhere to go without an event or a day', () => {
    expect(
      interviewCalendarHref({ icsUid: null, scheduledAt: null, calendarEmail: 'me@example.com', timezone: 'UTC' }),
    ).toBeNull();
  });
});
