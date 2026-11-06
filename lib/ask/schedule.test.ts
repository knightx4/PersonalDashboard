import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScheduleEntry } from '@/lib/todo/schedule/model';
import { foldSchedule } from '@/lib/todo/schedule/model';
import type { AskContext } from './db';

const loadSchedule = vi.fn();
vi.mock('@/lib/todo/schedule/load', () => ({ loadSchedule: (...args: unknown[]) => loadSchedule(...args) }));
vi.mock('@/lib/todo/agenda/clients', () => ({ clientsOver: () => ({}) }));

const { scheduleLookup } = await import('./schedule');

const ctx: AskContext = {
  userId: 'me',
  today: '2026-11-06',
  timezone: 'America/New_York',
  enabledModules: ['todo', 'jobs'],
  db: async () => {
    throw new Error('not read');
  },
  searchSources: [],
};

function entry(over: Partial<ScheduleEntry> & Pick<ScheduleEntry, 'key' | 'source' | 'title' | 'day' | 'ref' | 'from'>): ScheduleEntry {
  return {
    kind: 'booked',
    lastDay: over.day,
    startsAt: null,
    endsAt: null,
    allDay: false,
    location: null,
    detail: null,
    href: '/todo/calendar',
    alsoIn: [],
    conflicts: [],
    ...over,
  };
}

describe('schedule lookup (plan #3027)', () => {
  beforeEach(() => loadSchedule.mockReset());

  it('reads the whole weekend and lists a feed event, a reservation and an own event once each', async () => {
    const entries = foldSchedule([
      entry({ key: 'f1', source: 'feed_event', from: 'Partiful calendar', ref: 'todo.feed_events:f1', title: 'Diwali Bash', day: '2026-11-07', startsAt: '2026-11-07T23:00:00.000Z', location: '20 River Ct' }),
      entry({ key: 'a1', source: 'appointment', from: 'Booking email', ref: 'todo.appointments:a1', title: 'Double Chicken Please', day: '2026-11-08', startsAt: '2026-11-09T00:30:00.000Z' }),
      entry({ key: 'e1', source: 'own_event', from: 'Your calendar', ref: 'todo.events:e1', title: 'Double Chicken Please with Sam', day: '2026-11-08', startsAt: '2026-11-09T00:30:00.000Z' }),
      entry({ key: 'e2', source: 'own_event', from: 'Your calendar', ref: 'todo.events:e2', title: 'Brunch with Priya', day: '2026-11-08', startsAt: '2026-11-08T15:00:00.000Z' }),
    ]);
    loadSchedule.mockResolvedValue({ range: { from: '2026-11-07', to: '2026-11-08' }, timezone: ctx.timezone, entries, failed: [] });

    const result = await scheduleLookup(ctx, { from: '2026-11-07', to: '2026-11-08' });

    expect(loadSchedule).toHaveBeenCalledWith('me', { from: '2026-11-07', to: '2026-11-08', cut: false }, expect.objectContaining({ timezone: 'America/New_York' }));
    if (!result.ok) throw new Error(result.error);
    expect(result.rows.map((row) => [row.table, row.title])).toEqual([
      ['todo.feed_events', 'Diwali Bash'],
      ['todo.events', 'Brunch with Priya'],
      ['todo.appointments', 'Double Chicken Please'],
    ]);
    expect(result.rows[0].detail).toMatchObject({ weekday: 'Saturday', time: '6:00 PM', from: 'Partiful calendar', where: '20 River Ct' });
    expect(result.rows[2].detail).toMatchObject({ also_in: 'Your calendar', conflict: null });
    expect(result.note).not.toContain('Nothing at all');
  });

  it('puts a disagreement on time as a question, and names a day with nothing on it', async () => {
    const entries = foldSchedule([
      entry({ key: 'a1', source: 'appointment', from: 'Booking email', ref: 'todo.appointments:a1', title: 'Double Chicken Please', day: '2026-11-07', startsAt: '2026-11-08T01:00:00.000Z' }),
      entry({ key: 'e1', source: 'own_event', from: 'Your calendar', ref: 'todo.events:e1', title: 'Double Chicken Please with Sam', day: '2026-11-07', startsAt: '2026-11-08T00:30:00.000Z' }),
    ]);
    loadSchedule.mockResolvedValue({ range: { from: '2026-11-07', to: '2026-11-08' }, timezone: ctx.timezone, entries, failed: ['Booking emails'] });

    const result = await scheduleLookup(ctx, { from: '2026-11-07', to: '2026-11-08' });
    if (!result.ok) throw new Error(result.error);
    expect(result.rows).toHaveLength(2);
    expect(String(result.rows[0].detail?.conflict)).toContain('which is right?');
    expect(result.totals).toMatchObject({ conflicts: 2 });
    expect(result.note).toContain('Nothing at all on 2026-11-08');
    expect(result.note).toContain('ask them which is right');
    expect(result.note).toContain('Booking emails');
  });

  it('defaults to today', async () => {
    loadSchedule.mockResolvedValue({ range: { from: '2026-11-06', to: '2026-11-06' }, timezone: ctx.timezone, entries: [], failed: [] });
    await scheduleLookup(ctx, {});
    expect(loadSchedule.mock.calls[0][1]).toEqual({ from: '2026-11-06', to: '2026-11-06', cut: false });
  });
});
