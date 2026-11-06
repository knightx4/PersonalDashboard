import { describe, expect, it } from 'vitest';
import {
  conflictQuestion,
  daysOf,
  distinctiveWords,
  entriesOn,
  foldSchedule,
  scheduleRange,
  type ScheduleEntry,
} from './model';

const ZONE = 'America/New_York';

function entry(over: Partial<ScheduleEntry> & Pick<ScheduleEntry, 'key' | 'source' | 'title' | 'day'>): ScheduleEntry {
  return {
    kind: over.source === 'todo' || over.source === 'agenda' ? 'due' : 'booked',
    from: over.source,
    ref: `x.y:${over.key}`,
    lastDay: over.day,
    startsAt: null,
    endsAt: null,
    allDay: false,
    location: null,
    detail: null,
    href: '/todo',
    alsoIn: [],
    conflicts: [],
    ...over,
  } as ScheduleEntry;
}

describe('foldSchedule', () => {
  // The weekend of 6 November 2026 (plan #3027): a Partiful party, an emailed
  // reservation also on their calendar, and an event of their own.
  const party = entry({
    key: 'feed:1',
    source: 'feed_event',
    from: 'Partiful calendar',
    title: 'Diwali Bash ‘26 | Partiful',
    day: '2026-11-07',
    startsAt: '2026-11-07T23:00:00.000Z',
    location: '20 River Ct Apt 302, Jersey City, NJ',
  });
  const booking = entry({
    key: 'appointment:1',
    source: 'appointment',
    from: 'Booking email',
    title: 'Double Chicken Please',
    day: '2026-11-08',
    startsAt: '2026-11-09T00:30:00.000Z',
  });
  const ownDinner = entry({
    key: 'own_event:1',
    source: 'own_event',
    from: 'Your calendar',
    title: 'Double chicken please with Sam and Dawnee',
    day: '2026-11-08',
    startsAt: '2026-11-09T00:30:00.000Z',
  });
  const brunch = entry({
    key: 'own_event:2',
    source: 'own_event',
    from: 'Your calendar',
    title: 'Brunch with Priya',
    day: '2026-11-08',
    startsAt: '2026-11-08T15:00:00.000Z',
  });

  it('lists the feed event, the reservation and the own event once each', () => {
    const folded = foldSchedule([party, ownDinner, booking, brunch]);
    expect(folded.map((e) => e.title)).toEqual([
      'Diwali Bash ‘26 | Partiful',
      'Brunch with Priya',
      'Double Chicken Please',
    ]);
    const dinner = folded.find((e) => e.source === 'appointment')!;
    expect(dinner.alsoIn).toEqual([expect.objectContaining({ source: 'own_event', from: 'Your calendar' })]);
    expect(dinner.conflicts).toEqual([]);
  });

  it('keeps both times and flags each when two sources disagree on one thing', () => {
    const at730 = { ...ownDinner, startsAt: '2026-11-09T00:30:00.000Z' };
    const at800 = { ...booking, startsAt: '2026-11-09T01:00:00.000Z' };
    const folded = foldSchedule([at730, at800]);
    expect(folded).toHaveLength(2);
    expect(folded.every((e) => e.conflicts.length === 1)).toBe(true);
    const question = conflictQuestion(folded.find((e) => e.source === 'appointment')!, ZONE);
    expect(question).toContain('8:00');
    expect(question).toContain('7:30');
    expect(question).toContain('which is right?');
  });

  it('flags an interview round whose calendar copy is hours away', () => {
    const round = entry({
      key: 'interview:1',
      source: 'interview',
      from: 'Job interviews',
      title: 'Numeric · Implementation',
      day: '2026-11-06',
      startsAt: '2026-11-06T11:00:00.000Z',
    });
    const invite = entry({
      key: 'feed:2',
      source: 'feed_event',
      from: 'Google calendar',
      title: 'Interview with Numeric, Implementations Manager',
      day: '2026-11-06',
      startsAt: '2026-11-06T16:00:00.000Z',
    });
    const folded = foldSchedule([invite, round]);
    expect(folded.map((e) => e.conflicts.length)).toEqual([1, 1]);
  });

  it('does not tie an invite to another company\'s interview that day for sharing one word', () => {
    const numeric = entry({ key: 'interview:1', source: 'interview', title: 'Numeric · Implementation', day: '2026-11-06', startsAt: '2026-11-06T11:00:00.000Z' });
    const hyphenate = entry({ key: 'interview:2', source: 'interview', title: 'Hyphenate · Implementation / Accounting Consultant', day: '2026-11-06', startsAt: '2026-11-06T23:00:00.000Z' });
    const invite = entry({ key: 'feed:2', source: 'feed_event', title: 'Interview with Numeric, Implementations Manager', day: '2026-11-06', startsAt: '2026-11-06T16:00:00.000Z' });
    const folded = foldSchedule([invite, numeric, hyphenate]);
    expect(folded.find((e) => e.key === 'interview:2')!.conflicts).toEqual([]);
    expect(folded.find((e) => e.key === 'feed:2')!.conflicts.map((c) => c.ref)).toEqual(['x.y:interview:1']);
  });

  it('folds an interview and its calendar invite at the same time, the interview leading', () => {
    const round = entry({ key: 'interview:1', source: 'interview', title: 'Tabs · Implementation Lead', day: '2026-11-09', startsAt: '2026-11-09T19:00:00.000Z' });
    const invite = entry({ key: 'feed:3', source: 'feed_event', title: 'Interview with Tabs', day: '2026-11-09', startsAt: '2026-11-09T19:00:00.000Z', location: 'https://zoom.us/j/1' });
    const folded = foldSchedule([invite, round]);
    expect(folded).toHaveLength(1);
    expect(folded[0].source).toBe('interview');
    expect(folded[0].location).toBe('https://zoom.us/j/1');
  });

  it('does not match two things that share only a kind of word', () => {
    const a = entry({ key: 'own_event:3', source: 'own_event', title: 'Dinner with Sam', day: '2026-11-07', startsAt: '2026-11-07T23:00:00.000Z' });
    const b = entry({ key: 'appointment:2', source: 'appointment', title: 'Dinner at Lilia', day: '2026-11-07', startsAt: '2026-11-07T23:00:00.000Z' });
    const folded = foldSchedule([a, b]);
    expect(folded).toHaveLength(2);
    expect(folded.every((e) => e.alsoIn.length === 0 && e.conflicts.length === 0)).toBe(true);
  });

  it('never folds a todo into a meeting', () => {
    const todo = entry({ key: 'task:1', source: 'todo', title: 'Book Double Chicken Please', day: '2026-11-08' });
    expect(foldSchedule([todo, booking])).toHaveLength(2);
  });

  it('puts all-day entries before timed ones within a day', () => {
    const holiday = entry({ key: 'own_event:4', source: 'own_event', title: 'Diwali', day: '2026-11-08', allDay: true });
    expect(foldSchedule([brunch, holiday]).map((e) => e.title)).toEqual(['Diwali', 'Brunch with Priya']);
  });
});

describe('distinctiveWords', () => {
  it('drops kind words, short words and a plural s', () => {
    expect([...distinctiveWords('Interview with Numeric, Implementations Manager')]).toEqual([
      'numeric',
      'implementation',
      'manager',
    ]);
  });
});

describe('scheduleRange', () => {
  it('defaults to one day and turns a reversed range round', () => {
    expect(scheduleRange('2026-11-07')).toEqual({ from: '2026-11-07', to: '2026-11-07', cut: false });
    expect(scheduleRange('2026-11-08', '2026-11-07')).toEqual({ from: '2026-11-07', to: '2026-11-08', cut: false });
  });

  it('cuts a range longer than a month', () => {
    expect(scheduleRange('2026-11-01', '2027-01-01')).toEqual({ from: '2026-11-01', to: '2026-12-01', cut: true });
  });

  it('refuses a from that is not a day', () => {
    expect(scheduleRange('saturday')).toBeNull();
  });
});

describe('entriesOn and daysOf', () => {
  it('covers every day of a weekend, with a span on each day it runs', () => {
    const trip = entry({ key: 'own_event:5', source: 'own_event', title: 'Trip', day: '2026-11-06', lastDay: '2026-11-08', allDay: true });
    const days = daysOf({ from: '2026-11-07', to: '2026-11-08' });
    expect(days).toEqual(['2026-11-07', '2026-11-08']);
    expect(days.map((day) => entriesOn([trip], day).length)).toEqual([1, 1]);
  });
});
