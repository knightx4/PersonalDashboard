import { describe, expect, it } from 'vitest';
import { eventFields, type Event } from '@/lib/todo/events/model';
import { eventInput, resolveSpan } from '@/lib/todo/events/write';

const when = {
  allDay: false,
  startDay: '2026-03-10',
  endDay: null,
  startTime: null,
  endTime: null,
};

describe('resolveSpan', () => {
  it('turns a wall clock into an instant in the reader\'s zone', () => {
    const { span } = resolveSpan(
      { ...when, startTime: '14:00', endTime: '15:00' },
      'Europe/London',
    );
    // London is on GMT on 10 March, so 14:00 there is 14:00 UTC.
    expect(span).toEqual({
      starts_on: null,
      ends_on: null,
      starts_at: '2026-03-10T14:00:00.000Z',
      ends_at: '2026-03-10T15:00:00.000Z',
    });
  });

  it('is the same clock time after the clocks go forward', () => {
    // 29 March is when London moves to BST. 14:00 is still 14:00 to the person
    // typing it, and an hour earlier in UTC.
    const { span } = resolveSpan(
      { ...when, startDay: '2026-04-10', startTime: '14:00', endTime: '15:00' },
      'Europe/London',
    );
    expect(span?.starts_at).toBe('2026-04-10T13:00:00.000Z');
  });

  it('keeps an all-day event as dates, and ends it on its start day by default', () => {
    const { span } = resolveSpan({ ...when, allDay: true }, 'Asia/Tokyo');
    expect(span).toEqual({
      starts_on: '2026-03-10',
      ends_on: '2026-03-10',
      starts_at: null,
      ends_at: null,
    });
  });

  it('carries an all-day event across the days it runs', () => {
    const { span } = resolveSpan({ ...when, allDay: true, endDay: '2026-03-14' }, 'UTC');
    expect(span?.starts_on).toBe('2026-03-10');
    expect(span?.ends_on).toBe('2026-03-14');
  });

  it('lets a timed event run into the next day', () => {
    const { span } = resolveSpan(
      { ...when, endDay: '2026-03-11', startTime: '23:00', endTime: '01:00' },
      'UTC',
    );
    expect(span?.starts_at).toBe('2026-03-10T23:00:00.000Z');
    expect(span?.ends_at).toBe('2026-03-11T01:00:00.000Z');
  });

  it('refuses an end before its start, timed or all day', () => {
    const timed = resolveSpan({ ...when, startTime: '15:00', endTime: '14:00' }, 'UTC');
    expect(timed.span).toBeNull();
    expect(timed.error).toBe('It cannot end before it starts.');

    const allDay = resolveSpan({ ...when, allDay: true, endDay: '2026-03-09' }, 'UTC');
    expect(allDay.span).toBeNull();
    expect(allDay.error).toBe('It cannot end before it starts.');
  });

  it('refuses a timed event with no times rather than inventing a length', () => {
    const { span, error } = resolveSpan(when, 'UTC');
    expect(span).toBeNull();
    expect(error).toMatch(/start and an end time/);
  });
});

describe('eventInput', () => {
  it('reads a form, treating blank optional fields as absent', () => {
    const parsed = eventInput.parse({
      title: '  Dentist ',
      body: '',
      location: '',
      allDay: false,
      startDay: '2026-03-10',
      endDay: '',
      startTime: '15:00',
      endTime: '15:30',
    });

    expect(parsed.title).toBe('Dentist');
    expect(parsed.body).toBeNull();
    expect(parsed.location).toBeNull();
    expect(parsed.endDay).toBeNull();
  });

  it('refuses a blank title and a day that is not one', () => {
    const blank = eventInput.safeParse({
      title: '   ',
      body: '',
      location: '',
      allDay: true,
      startDay: '2026-03-10',
      endDay: '',
      startTime: '',
      endTime: '',
    });
    expect(blank.success).toBe(false);

    const nonsense = eventInput.safeParse({
      title: 'Dentist',
      body: '',
      location: '',
      allDay: true,
      startDay: 'thursday',
      endDay: '',
      startTime: '',
      endTime: '',
    });
    expect(nonsense.success).toBe(false);
  });
});

describe('eventFields and resolveSpan together', () => {
  function stored(over: Partial<Event>): Event {
    return {
      id: 'e1',
      title: 'Something',
      body: null,
      location: null,
      startsOn: null,
      endsOn: null,
      startsAt: null,
      endsAt: null,
      createdAt: '2026-03-01T00:00:00.000Z',
      ...over,
    };
  }

  /**
   * Opening an event and saving it without touching anything has to leave the
   * same row. That is one function reading what the other wrote, and the two
   * are only correct together.
   */
  function roundTrip(event: Event, timezone: string) {
    const fields = eventFields(event, timezone);
    return resolveSpan(fields, timezone).span;
  }

  it('leaves a timed event exactly as it was', () => {
    const meeting = stored({
      startsAt: '2026-03-10T15:00:00.000Z',
      endsAt: '2026-03-10T15:30:00.000Z',
    });

    expect(roundTrip(meeting, 'Europe/London')).toEqual({
      starts_on: null,
      ends_on: null,
      starts_at: '2026-03-10T15:00:00.000Z',
      ends_at: '2026-03-10T15:30:00.000Z',
    });
  });

  it('leaves one that runs past midnight as it was', () => {
    const night = stored({
      startsAt: '2026-03-10T23:00:00.000Z',
      endsAt: '2026-03-11T01:00:00.000Z',
    });
    const fields = eventFields(night, 'UTC');

    expect(fields.startDay).toBe('2026-03-10');
    expect(fields.endDay).toBe('2026-03-11');
    expect(roundTrip(night, 'UTC')).toEqual({
      starts_on: null,
      ends_on: null,
      starts_at: '2026-03-10T23:00:00.000Z',
      ends_at: '2026-03-11T01:00:00.000Z',
    });
  });

  it('leaves an all-day event over several days as it was', () => {
    const holiday = stored({ startsOn: '2026-03-10', endsOn: '2026-03-14' });
    const fields = eventFields(holiday, 'Asia/Tokyo');

    expect(fields.allDay).toBe(true);
    expect(roundTrip(holiday, 'Asia/Tokyo')).toEqual({
      starts_on: '2026-03-10',
      ends_on: '2026-03-14',
      starts_at: null,
      ends_at: null,
    });
  });

  it('reads a timed event in the reader s own zone', () => {
    // 15:00 UTC is midnight in Tokyo, on the following day.
    const fields = eventFields(
      stored({ startsAt: '2026-03-10T15:00:00.000Z', endsAt: '2026-03-10T16:00:00.000Z' }),
      'Asia/Tokyo',
    );

    expect(fields.startDay).toBe('2026-03-11');
    expect(fields.startTime).toBe('00:00');
    expect(fields.endTime).toBe('01:00');
    expect(fields.endDay).toBe('');
  });

  it('leaves the end day empty when there is only one day', () => {
    expect(eventFields(stored({ startsOn: '2026-03-10', endsOn: '2026-03-10' }), 'UTC').endDay).toBe(
      '',
    );
  });
});
