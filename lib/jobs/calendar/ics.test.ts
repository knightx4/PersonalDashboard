import { describe, expect, it } from 'vitest';
import { parseIcs, parseIcsDuration, primaryEvent } from './ics';

/** A Google Calendar invite, folded and escaped the way Google emits it. */
const GOOGLE_INVITE = [
  'BEGIN:VCALENDAR',
  'PRODID:-//Google Inc//Google Calendar 70.9054//EN',
  'VERSION:2.0',
  'CALSCALE:GREGORIAN',
  'METHOD:REQUEST',
  'BEGIN:VEVENT',
  'DTSTART;TZID=America/New_York:20260903T140000',
  'DTEND;TZID=America/New_York:20260903T144500',
  'DTSTAMP:20260828T171500Z',
  'UID:6k1p9c8m4v2q@google.com',
  'ORGANIZER;CN=Dana Ruiz:mailto:dana.ruiz@ramp.com',
  'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;CN=Pri',
  ' ya Anand;X-NUM-GUESTS=0:mailto:priya.anand@ramp.com',
  'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;CN=you@example.com;X-NUM-GUE',
  ' STS=0:mailto:you@example.com',
  'X-GOOGLE-CONFERENCE:https://meet.google.com/abc-defg-hij',
  'SEQUENCE:0',
  'STATUS:CONFIRMED',
  'SUMMARY:Ramp / Recruiter screen',
  'DESCRIPTION:Hi\\, looking forward to it.\\n\\nJoin: https://meet.google.com/abc-d',
  ' efg-hij\\nOr dial in.',
  'LOCATION:Google Meet',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

describe('parseIcs', () => {
  it('reads a folded Google invite down to the instant', () => {
    const [event] = parseIcs(GOOGLE_INVITE);

    expect(event.uid).toBe('6k1p9c8m4v2q@google.com');
    expect(event.method).toBe('REQUEST');
    expect(event.summary).toBe('Ramp / Recruiter screen');
    // 14:00 in New York on 3 September is EDT, so 18:00Z.
    expect(event.startsAt?.toISOString()).toBe('2026-09-03T18:00:00.000Z');
    expect(event.endsAt?.toISOString()).toBe('2026-09-03T18:45:00.000Z');
    expect(event.durationMinutes).toBe(45);
    expect(event.timeZone).toBe('America/New_York');
    expect(event.cancelled).toBe(false);
  });

  it('rejoins folded lines rather than losing half the value', () => {
    const [event] = parseIcs(GOOGLE_INVITE);
    // The DESCRIPTION was folded mid-URL; unfolding is what keeps it a URL.
    expect(event.description).toContain('https://meet.google.com/abc-defg-hij');
    expect(event.description).toContain('Hi, looking forward to it.');
    expect(event.description).toContain('\n');
  });

  it('reads attendees with their display names', () => {
    const [event] = parseIcs(GOOGLE_INVITE);

    expect(event.organizer).toEqual({
      name: 'Dana Ruiz',
      email: 'dana.ruiz@ramp.com',
      role: null,
    });
    expect(event.attendees).toHaveLength(2);
    expect(event.attendees[0]).toEqual({
      name: 'Priya Anand',
      email: 'priya.anand@ramp.com',
      role: 'REQ-PARTICIPANT',
    });
    // A CN that only repeats the address is not a name.
    expect(event.attendees[1].name).toBeNull();
  });

  it('prefers the conference property over scraping the body', () => {
    const [event] = parseIcs(GOOGLE_INVITE);
    expect(event.conferenceUrl).toBe('https://meet.google.com/abc-defg-hij');
  });
});

describe('timezone handling', () => {
  it('treats a trailing Z as UTC', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:z@example.com',
      'DTSTART:20260903T140000Z',
      'DTEND:20260903T150000Z',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const [event] = parseIcs(ics);
    expect(event.startsAt?.toISOString()).toBe('2026-09-03T14:00:00.000Z');
    expect(event.durationMinutes).toBe(60);
  });

  it('gets the hour right on both sides of a DST boundary', () => {
    // US DST ended 1 November 2026. Same wall clock, different offsets.
    const before = parseIcs(
      [
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'UID:a',
        'DTSTART;TZID=America/New_York:20261030T100000',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n'),
    )[0];
    const after = parseIcs(
      [
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'UID:b',
        'DTSTART;TZID=America/New_York:20261106T100000',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n'),
    )[0];

    expect(before.startsAt?.toISOString()).toBe('2026-10-30T14:00:00.000Z'); // EDT
    expect(after.startsAt?.toISOString()).toBe('2026-11-06T15:00:00.000Z'); // EST
  });

  it('reads a floating time in the timezone it is given', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:floating',
      'DTSTART:20260903T090000',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const [event] = parseIcs(ics, { defaultTimeZone: 'Europe/London' });
    expect(event.startsAt?.toISOString()).toBe('2026-09-03T08:00:00.000Z');
  });

  it('falls back to the wall clock when the zone is one nobody has heard of', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:badzone',
      'DTSTART;TZID=Mars/Olympus_Mons:20260903T090000',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const [event] = parseIcs(ics);
    expect(event.startsAt?.toISOString()).toBe('2026-09-03T09:00:00.000Z');
  });
});

describe('cancellations and reschedules', () => {
  it('marks METHOD:CANCEL as cancelled', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'METHOD:CANCEL',
      'BEGIN:VEVENT',
      'UID:6k1p9c8m4v2q@google.com',
      'SEQUENCE:2',
      'STATUS:CANCELLED',
      'DTSTART;TZID=America/New_York:20260903T140000',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const [event] = parseIcs(ics);
    expect(event.cancelled).toBe(true);
    expect(event.sequence).toBe(2);
    // The uid is unchanged, which is what makes this the same interview.
    expect(event.uid).toBe('6k1p9c8m4v2q@google.com');
  });

  it('carries the bumped sequence on a reschedule', () => {
    const ics = GOOGLE_INVITE.replace('SEQUENCE:0', 'SEQUENCE:3').replace(
      'DTSTART;TZID=America/New_York:20260903T140000',
      'DTSTART;TZID=America/New_York:20260904T160000',
    );
    const [event] = parseIcs(ics);
    expect(event.sequence).toBe(3);
    expect(event.startsAt?.toISOString()).toBe('2026-09-04T20:00:00.000Z');
  });
});

describe('shapes that are not a Google invite', () => {
  it('derives the end from a DURATION when there is no DTEND', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:d',
      'DTSTART:20260903T140000Z',
      'DURATION:PT1H30M',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const [event] = parseIcs(ics);
    expect(event.durationMinutes).toBe(90);
    expect(event.endsAt?.toISOString()).toBe('2026-09-03T15:30:00.000Z');
  });

  it('finds a Zoom link in the location when there is no conference property', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:zoom',
      'DTSTART:20260903T140000Z',
      'LOCATION:https://acme.zoom.us/j/98765432101?pwd=abcdef',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const [event] = parseIcs(ics);
    expect(event.conferenceUrl).toBe('https://acme.zoom.us/j/98765432101?pwd=abcdef');
  });

  it('marks an onsite with a street address and no link', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:onsite',
      'DTSTART;TZID=America/New_York:20260910T090000',
      'LOCATION:28 W 23rd St\\, 2nd Floor\\, New York\\, NY 10010',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const [event] = parseIcs(ics);
    expect(event.conferenceUrl).toBeNull();
    expect(event.location).toBe('28 W 23rd St, 2nd Floor, New York, NY 10010');
  });

  it('ignores a VALARM rather than reading its description as the event', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:alarm',
      'SUMMARY:Technical interview',
      'DTSTART:20260903T140000Z',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'DESCRIPTION:This is an event reminder',
      'TRIGGER:-P0DT0H30M0S',
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const [event] = parseIcs(ics);
    expect(parseIcs(ics)).toHaveLength(1);
    expect(event.summary).toBe('Technical interview');
    expect(event.description).toBeNull();
  });

  it('handles an all-day event without pretending it has a time', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:allday',
      'DTSTART;VALUE=DATE:20260903',
      'DTEND;VALUE=DATE:20260904',
      'SUMMARY:Take-home due',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const [event] = parseIcs(ics);
    expect(event.allDay).toBe(true);
    expect(event.startsAt?.toISOString()).toBe('2026-09-03T00:00:00.000Z');
  });

  it('returns nothing for a body that is not a calendar', () => {
    expect(parseIcs('Thanks for applying! We will be in touch.')).toEqual([]);
    expect(parseIcs('')).toEqual([]);
  });

  it('does not throw on a truncated invite', () => {
    const ics = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:trunc\r\nDTSTART;TZID=Ameri';
    expect(() => parseIcs(ics)).not.toThrow();
    expect(parseIcs(ics)).toEqual([]);
  });
});

describe('parseIcsDuration', () => {
  it('reads the forms calendars actually emit', () => {
    expect(parseIcsDuration('PT45M')).toBe(45);
    expect(parseIcsDuration('PT1H')).toBe(60);
    expect(parseIcsDuration('PT1H30M')).toBe(90);
    expect(parseIcsDuration('P1D')).toBe(1440);
    expect(parseIcsDuration('P1W')).toBe(10080);
    expect(parseIcsDuration('nonsense')).toBeNull();
  });
});

describe('primaryEvent', () => {
  it('prefers a cancellation over a re-booking in the same message', () => {
    const events = parseIcs(
      [
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'UID:new',
        'DTSTART:20260904T140000Z',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:old',
        'STATUS:CANCELLED',
        'DTSTART:20260903T140000Z',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n'),
    );

    expect(primaryEvent(events)?.uid).toBe('old');
  });

  it('takes the earliest timed event otherwise', () => {
    const events = parseIcs(
      [
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'UID:later',
        'DTSTART:20260905T140000Z',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:earlier',
        'DTSTART:20260903T140000Z',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n'),
    );

    expect(primaryEvent(events)?.uid).toBe('earlier');
  });

  it('is null for no events', () => {
    expect(primaryEvent([])).toBeNull();
  });
});
