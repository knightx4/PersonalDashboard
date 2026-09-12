import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCalendar, UNTITLED, type FeedEvent } from '@/lib/todo/feeds/parse';

/**
 * The files under fixtures/calendars/ are shaped exactly as Google, Apple and
 * Outlook publish them, down to the properties nothing here reads. A parser
 * tested against files this repository invented is a parser tested against
 * itself.
 */
function fixture(name: string): string {
  return readFileSync(join(process.cwd(), 'fixtures', 'calendars', name), 'utf8');
}

const MARCH = { from: '2026-03-01', to: '2026-03-31' };

function byUid(events: FeedEvent[], uid: string): FeedEvent[] {
  return events.filter((event) => event.uid === uid);
}

describe('parseCalendar', () => {
  it('reads a whole-day event as the days it covers, not the day after', () => {
    // A calendar file writes the end as the day AFTER the last one. Keeping
    // that convention would put a holiday stripe on the Saturday somebody
    // came home.
    const [holiday] = byUid(parseCalendar(fixture('whole-day.ics'), MARCH), 'holiday-lisbon@google.com');

    expect(holiday.startsOn).toBe('2026-03-16');
    expect(holiday.endsOn).toBe('2026-03-20');
    expect(holiday.startsAt).toBeNull();
    expect(holiday.location).toBe('Lisbon');
    expect(holiday.body).toBe('Flights booked, hotel not');
  });

  it('reads a single whole day as one day', () => {
    const [day] = byUid(parseCalendar(fixture('whole-day.ics'), MARCH), 'bank-holiday@google.com');

    expect(day.startsOn).toBe('2026-03-10');
    expect(day.endsOn).toBe('2026-03-10');
  });

  it('keeps an appointment that crosses midnight on the clock', () => {
    // 23:00 to 01:00 GMT. Both instants, and the end is genuinely the next
    // day -- which is the reader's problem to draw, not this one's to flatten.
    const [shift] = byUid(parseCalendar(fixture('whole-day.ics'), MARCH), 'late-shift@google.com');

    expect(shift.startsAt).toBe('2026-03-12T23:00:00.000Z');
    expect(shift.endsAt).toBe('2026-03-13T01:00:00.000Z');
    expect(shift.startsOn).toBeNull();
  });

  it('leaves out an appointment the file says is off', () => {
    expect(byUid(parseCalendar(fixture('whole-day.ics'), MARCH), 'cancelled-day@google.com')).toEqual(
      [],
    );
  });

  it('gives an appointment with no name one, so it can be drawn', () => {
    const [nameless] = byUid(parseCalendar(fixture('whole-day.ics'), MARCH), 'no-name@google.com');
    expect(nameless.title).toBe(UNTITLED);
  });

  it('expands a weekly repeat into one occurrence per date', () => {
    const events = parseCalendar(fixture('weekly-repeat.ics'), MARCH);

    // Mondays in March 2026: 2nd, 9th, 16th, 23rd, 30th.
    expect(events.map((event) => event.startsAt?.slice(0, 10)).sort()).toEqual([
      '2026-03-02',
      '2026-03-09',
      '2026-03-23',
      '2026-03-30',
    ]);
  });

  it('leaves out a date the file says was cancelled', () => {
    // EXDATE on the 16th. An occurrence that is still drawn after somebody
    // deleted it is the failure people notice fastest.
    const days = parseCalendar(fixture('weekly-repeat.ics'), MARCH).map((event) =>
      event.startsAt?.slice(0, 10),
    );

    expect(days).not.toContain('2026-03-16');
  });

  it('puts an edited occurrence in place of the one it replaces', () => {
    const moved = parseCalendar(fixture('weekly-repeat.ics'), MARCH).find(
      (event) => event.startsAt?.slice(0, 10) === '2026-03-23',
    );

    expect(moved?.title).toBe('Stand-up (moved)');
    expect(moved?.startsAt).toBe('2026-03-23T11:00:00.000Z');
    expect(moved?.location).toBe('Room 5');
  });

  it('reads a time in a zone the file defines itself', () => {
    // "Customized Time Zone" means nothing to anyone until the file's own
    // VTIMEZONE is read. Without it the time floats and lands hours out. On
    // 5 March the rule above is still standard time, so 09:00 is 14:00 UTC.
    const [review] = parseCalendar(fixture('own-timezone.ics'), MARCH);

    expect(review.startsAt).toBe('2026-03-05T14:00:00.000Z');
    expect(review.endsAt).toBe('2026-03-05T15:00:00.000Z');
  });

  it('keeps only what touches the window', () => {
    const events = parseCalendar(fixture('weekly-repeat.ics'), {
      from: '2026-03-09',
      to: '2026-03-09',
    });

    expect(events.map((event) => event.startsAt)).toEqual(['2026-03-09T09:30:00.000Z']);
  });

  it('says nothing at all about a calendar with nothing in it', () => {
    const empty = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\nEND:VCALENDAR';
    expect(parseCalendar(empty, MARCH)).toEqual([]);
  });
});
