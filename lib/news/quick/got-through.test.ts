import { describe, expect, it } from 'vitest';
import type { NewsSender } from '@/lib/news/issues/list';
import {
  BREAK_MS,
  dueNext,
  dueWhen,
  gotThrough,
  heldFor,
  passesToday,
  timeOnEach,
  type TimedPass,
} from './got-through';
import type { QuickIssue } from './next';

const at = (iso: string) => `2026-10-03T${iso}Z`;

function pass(issueId: string, storyIndex: number, time: string, opened = false): TimedPass {
  return { issueId, storyIndex, passedAt: at(time), openedAt: opened ? at(time) : null };
}

const issues: QuickIssue[] = [
  {
    id: 'a',
    senderId: 's1',
    subject: 'Morning letter',
    receivedAt: at('06:00:00'),
    summary: 'x',
    stories: [
      { headline: 'Rates held', summary: 'The bank held.' },
      { headline: 'Rail strike', summary: 'Trains stop.' },
      { headline: 'Harvest late', summary: 'Rain.' },
    ],
  },
  {
    id: 'b',
    senderId: 's2',
    subject: 'One long essay',
    receivedAt: at('05:00:00'),
    summary: 'y',
    stories: [],
  },
];

describe('timeOnEach', () => {
  it('times a story from the pass before it, and gives the first none', () => {
    const times = timeOnEach([pass('a', 0, '08:00:00'), pass('a', 1, '08:00:30')]);
    expect(times).toEqual([null, 30_000]);
  });

  it('splits a page passed in one go between its stories', () => {
    const times = timeOnEach([
      pass('a', 0, '08:00:00'),
      pass('a', 1, '08:01:00'),
      pass('a', 2, '08:01:00'),
    ]);
    expect(times).toEqual([null, 30_000, 30_000]);
  });

  it('reads a long gap as a break, not reading', () => {
    const later = new Date(Date.parse(at('08:00:00')) + BREAK_MS + 1000).toISOString();
    const times = timeOnEach([
      pass('a', 0, '08:00:00'),
      { issueId: 'a', storyIndex: 1, passedAt: later, openedAt: null },
    ]);
    expect(times).toEqual([null, null]);
  });
});

describe('gotThrough', () => {
  it('counts a quick pass as skipped, and an opened or held story as read', () => {
    const result = gotThrough(
      [
        pass('a', 0, '08:00:00'),
        pass('a', 1, '08:00:03'),
        pass('a', 2, '08:00:05', true),
        pass('b', 0, '08:02:05'),
      ],
      issues,
    );
    expect(result.read).toBe(3);
    expect(result.skipped).toBe(1);
    expect(result.longest).toEqual({ headline: 'One long essay', ms: 120_000 });
  });

  it('has no longest when no story has a time', () => {
    expect(gotThrough([pass('a', 0, '08:00:00')], issues)).toEqual({
      read: 1,
      skipped: 0,
      longest: null,
    });
  });
});

describe('passesToday', () => {
  it('keeps today in the account zone, oldest first', () => {
    const now = new Date(at('12:00:00'));
    const kept = passesToday(
      [
        pass('a', 1, '09:00:00'),
        pass('a', 0, '08:00:00'),
        { ...pass('a', 2, '00:00:00'), passedAt: '2026-10-02T20:00:00Z' },
      ],
      'Europe/London',
      now,
    );
    expect(kept.map((p) => p.storyIndex)).toEqual([0, 1]);
  });
});

describe('heldFor', () => {
  it('says seconds under a minute and minutes after', () => {
    expect(heldFor(40_000)).toBe('40 seconds');
    expect(heldFor(61_000)).toBe('1 minute');
    expect(heldFor(190_000)).toBe('3 minutes');
  });
});

describe('dueNext', () => {
  const senders: NewsSender[] = [
    { id: 'daily', email: 'd@x', name: 'The Daily', muted: false },
    { id: 'weekly', email: 'w@x', name: 'The Weekly', muted: false },
    { id: 'quiet', email: 'q@x', name: 'Quiet', muted: true },
  ];
  const day = 86_400_000;
  const now = new Date('2026-10-03T12:00:00Z');
  const issueAt = (senderId: string, msAgo: number) => ({
    senderId,
    receivedAt: new Date(now.getTime() - msAgo).toISOString(),
  });

  it('expects each sender one usual gap after its last, soonest first, leaving muted ones out', () => {
    const due = dueNext(
      [
        issueAt('daily', 0.25 * day),
        issueAt('daily', 1.25 * day),
        issueAt('daily', 2.25 * day),
        issueAt('weekly', 2 * day),
        issueAt('weekly', 9 * day),
        issueAt('weekly', 16 * day),
        issueAt('quiet', 0.1 * day),
        issueAt('quiet', 1.1 * day),
        issueAt('quiet', 2.1 * day),
      ],
      senders,
      now,
    );
    expect(due.map((d) => d.from)).toEqual(['The Daily', 'The Weekly']);
    expect(due[0].at.toISOString()).toBe('2026-10-04T06:00:00.000Z');
  });

  it('leaves out a sender with too few issues or one that has gone quiet', () => {
    expect(dueNext([issueAt('daily', day), issueAt('daily', 2 * day)], senders, now)).toEqual([]);
    expect(
      dueNext(
        [issueAt('daily', 10 * day), issueAt('daily', 11 * day), issueAt('daily', 12 * day)],
        senders,
        now,
      ),
    ).toEqual([]);
  });
});

describe('dueWhen', () => {
  const now = new Date('2026-10-03T12:00:00Z');
  it('names tomorrow, a weekday, or a date further out', () => {
    expect(dueWhen(new Date('2026-10-04T06:10:00Z'), 'UTC', now)).toBe('tomorrow around 6:00 AM');
    expect(dueWhen(new Date('2026-10-06T07:00:00Z'), 'UTC', now)).toBe('on Tuesday around 7:00 AM');
    expect(dueWhen(new Date('2026-10-03T18:00:00Z'), 'UTC', now)).toBe(
      'later today around 6:00 PM',
    );
  });
});
