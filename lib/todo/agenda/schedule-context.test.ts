import { describe, expect, it } from 'vitest';
import { scheduleContext } from '@/lib/todo/agenda/schedule-context';
import { foldSchedule, type ScheduleEntry } from '@/lib/todo/schedule/model';

const TZ = 'America/New_York';
const TODAY = '2026-11-07';

function entry(extra: Partial<ScheduleEntry> & Pick<ScheduleEntry, 'key' | 'source' | 'from' | 'title' | 'day'>): ScheduleEntry {
  return {
    kind: 'booked',
    ref: `todo.events:${extra.key}`,
    lastDay: extra.day,
    startsAt: null,
    endsAt: null,
    allDay: false,
    location: null,
    detail: null,
    href: `/todo/calendar?date=${extra.day}`,
    alsoIn: [],
    conflicts: [],
    ...extra,
  };
}

describe('scheduleContext', () => {
  it('shows a feed event, an appointment and an own event that are one dinner once, naming the others', () => {
    const at = '2026-11-08T01:00:00.000Z';
    const rows = scheduleContext(
      foldSchedule([
        entry({ key: 'own_event:a', source: 'own_event', from: 'Your calendar', title: 'Dinner at Lilia', day: TODAY, startsAt: at }),
        entry({ key: 'feed_event:b', source: 'feed_event', from: 'Partiful calendar', title: 'Dinner at Lilia', day: TODAY, startsAt: at }),
        entry({ key: 'appointment:c', source: 'appointment', from: 'Booking email', title: 'Dinner at Lilia', day: TODAY, startsAt: at, detail: 'Resy' }),
      ]),
      TZ,
      TODAY,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: 'appointment:c', at, label: 'Dinner at Lilia', detail: 'Resy', question: null });
    expect(rows[0].alsoIn).toEqual(['Your calendar', 'Partiful calendar']);
  });

  it('asks which time is right on both copies of an interview that disagree', () => {
    const rows = scheduleContext(
      foldSchedule([
        entry({
          key: 'interview:i',
          source: 'interview',
          from: 'Job interviews',
          title: 'Numeric · Implementation Lead',
          day: '2026-11-09',
          startsAt: '2026-11-09T15:00:00.000Z',
          href: '/jobs/roles/r1?tab=interviews&interview=i',
        }),
        entry({
          key: 'feed_event:g',
          source: 'feed_event',
          from: 'Google calendar',
          title: 'Numeric Implementation Lead interview',
          day: '2026-11-09',
          startsAt: '2026-11-09T16:00:00.000Z',
        }),
      ]),
      TZ,
      TODAY,
    );
    expect(rows).toHaveLength(2);
    const interview = rows.find((row) => row.key === 'interview:i')!;
    expect(interview.link).toEqual({ href: '/jobs/roles/r1?tab=interviews&interview=i', label: 'Prep' });
    expect(interview.question).toMatch(/^Google calendar says 11:00.*\. Which is right\?$/);
    expect(rows.find((row) => row.key === 'feed_event:g')!.question).toMatch(/^Job interviews says 10:00.*\. Which is right\?$/);
  });

  it('puts a span that began before today on today without its clock, and leaves out what is over and what is due', () => {
    const rows = scheduleContext(
      [
        entry({ key: 'own_event:v', source: 'own_event', from: 'Your calendar', title: 'Visit', day: '2026-11-06', lastDay: '2026-11-09', startsAt: '2026-11-06T14:00:00.000Z' }),
        entry({ key: 'own_event:o', source: 'own_event', from: 'Your calendar', title: 'Over', day: '2026-11-06' }),
        entry({ key: 'task:t', source: 'todo', kind: 'due', from: 'Todo', title: 'A todo', day: TODAY }),
      ],
      TZ,
      TODAY,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: 'own_event:v', day: TODAY, at: null });
    expect(rows[0].detail).toMatch(/^until /);
  });
});
