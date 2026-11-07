import 'server-only';

import { loadAccountSettings } from '@/lib/core/account/settings';
import type { ModuleId } from '@/lib/modules';
import { endDay, isAllDay, startDay, type Event } from '@/lib/todo/events/model';
import { loadEventsInWindow } from '@/lib/todo/events/load';
import { loadFeedEventsInWindow, type SubscribedEvent } from '@/lib/todo/feeds/load';
import { syncStaleFeeds } from '@/lib/todo/feeds/refresh';
import { loadOpenTasks } from '@/lib/todo/tasks/load';
import { addDays, dueDay, isSnoozed, type Task } from '@/lib/todo/tasks/model';
import { sessionClients, type AgendaClients } from '@/lib/todo/agenda/clients';
import { loadDismissals } from '@/lib/todo/agenda/dismissals';
import { stillHidden } from '@/lib/todo/agenda/merge';
import type { AgendaItem, AgendaSource, DayContext, SourceContext } from '@/lib/todo/agenda/sources';
import { jobInterviewsSource } from '@/lib/todo/agenda/sources/job-interviews';
import { jobRemindersSource } from '@/lib/todo/agenda/sources/job-reminders';
import { billsSource } from '@/lib/todo/agenda/sources/bills';
import { returnDeadlinesSource } from '@/lib/todo/agenda/sources/return-deadlines';
import { goalStepsSource } from '@/lib/todo/agenda/sources/goal-steps';
import { foldSchedule, type ScheduleEntry, type ScheduleRange } from './model';

/**
 * Reads the schedule for a range of days (plan #3027; model.ts says what it
 * is for).
 *
 * Every read runs at once and a read that fails costs only its own entries,
 * named in `failed`, so a broken calendar feed never empties the day.
 *
 * Todo's agenda switches decide what the Todo page lists, not what the day
 * holds: an interview is on Thursday whether or not the agenda shows
 * interviews. So the schedule reads every source of dated things whose
 * workspace is on, whatever those switches say. What the person dismissed or
 * put off on the agenda stays hidden here too.
 *
 * Every read names the person, so the service-role clients the morning brief
 * and the connector pass are as safe as the session's (clients.ts).
 *
 * Subscribed calendars are re-read first when their copy is over an hour old
 * (plan #3045), so a bot asked about tonight sees the invite that arrived
 * since anybody opened the calendar. Each re-read gets a few seconds; one
 * that fails or is slow leaves its stored rows in place and its name in
 * `stale`, for the reader to say that calendar may be out of date.
 */

export interface Schedule {
  range: ScheduleRange;
  timezone: string;
  entries: ScheduleEntry[];
  /** The sources that did not answer, in words. */
  failed: string[];
  /** Subscribed calendars that could not be re-read just now, by name, so may be out of date. */
  stale: string[];
}

export interface ScheduleOptions {
  clients?: AgendaClients;
  now?: Date;
  /** The reader's zone and workspaces, when the caller already has them. */
  timezone?: string;
  enabledModules?: readonly ModuleId[];
  /**
   * Only what holds a place in the day: events, calendars, booking emails and
   * interviews. The agenda reads todos and reminders itself, as rows to act
   * on (plan #3027.1), so it asks for these alone rather than reading them twice.
   */
  bookedOnly?: boolean;
}

/** The agenda sources whose items fall on a day, each with the workspace it reads. */
const DATED_SOURCES: AgendaSource[] = [jobRemindersSource, billsSource, returnDeadlinesSource, goalStepsSource];

export async function loadSchedule(
  userId: string,
  range: ScheduleRange,
  options: ScheduleOptions = {},
): Promise<Schedule> {
  const clients = options.clients ?? sessionClients;
  const now = options.now ?? new Date();
  const todo = await clients.todo();

  let timezone = options.timezone;
  let enabled = options.enabledModules;
  if (!timezone || !enabled) {
    const account = await loadAccountSettings(userId, await clients.core());
    timezone ??= account.timezone;
    enabled ??= account.enabledModules;
  }
  const zone = timezone;
  const on = (module: ModuleId) => enabled.includes(module);

  const ctx: SourceContext = { userId, timezone: zone, from: range.from, to: range.to, now, clients };

  const stale: string[] = [];
  const reads: { label: string; run: () => Promise<ScheduleEntry[]> }[] = [
    {
      label: 'Your calendar',
      run: async () =>
        (await loadEventsInWindow(userId, range, zone, todo)).map((event) => eventEntry(event, zone, 'own_event', 'Your calendar')),
    },
    {
      label: 'Subscribed calendars',
      run: async () => {
        const behind = await syncStaleFeeds(userId, { client: todo, now, timezone: zone }).catch(() => [] as string[]);
        stale.push(...behind.map((name) => `${name} calendar`));
        const events = await loadFeedEventsInWindow(userId, range, zone, todo);
        const names = await feedNames(userId, events, clients);
        return events.map((event) =>
          eventEntry(event, zone, 'feed_event', `${names.get(event.feedId) ?? 'Subscribed'} calendar`),
        );
      },
    },
    { label: 'Booking emails', run: () => appointmentEntries(userId, range, clients) },
  ];
  if (!options.bookedOnly) {
    reads.push({ label: 'Todos', run: async () => taskEntries(await loadOpenTasks(userId, todo), range, zone, now) });
  }

  if (on('jobs')) {
    reads.push({
      label: 'Interviews',
      run: async () => {
        // The source bounds its read by UTC days, so it is asked a day either
        // side and its rows, already placed on the reader's days, are cut here.
        const wide = { ...ctx, from: addDays(range.from, -1), to: addDays(range.to, 1) };
        return (await jobInterviewsSource.context!(wide))
          .filter((row) => row.day >= range.from && row.day <= range.to)
          .map(interviewEntry);
      },
    });
  }

  const dated = options.bookedOnly ? [] : DATED_SOURCES.filter((source) => on(source.module));
  if (dated.length > 0) {
    reads.push({
      label: 'Reminders and deadlines',
      run: async () => {
        const [dismissals, ...found] = await Promise.all([
          loadDismissals(userId, todo),
          ...dated.map((source) => source.fetch(ctx).catch(() => [] as AgendaItem[])),
        ]);
        return found
          .flat()
          .filter((item) => item.day && item.day >= range.from && item.day <= range.to)
          .filter((item) => !stillHidden(dismissals.get(item.key), now))
          .map((item) => itemEntry(item, dated));
      },
    });
  }

  const settled = await Promise.allSettled(reads.map((read) => read.run()));
  const entries: ScheduleEntry[] = [];
  const failed: string[] = [];
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') entries.push(...result.value);
    else {
      console.error(`schedule read ${reads[index].label} failed`, result.reason);
      failed.push(reads[index].label);
    }
  });

  return { range, timezone: zone, entries: foldSchedule(entries), failed, stale };
}

/** The names of the calendars these subscribed events came from, by feed id. */
async function feedNames(
  userId: string,
  events: readonly SubscribedEvent[],
  clients: AgendaClients,
): Promise<Map<string, string>> {
  const ids = [...new Set(events.map((event) => event.feedId))];
  if (ids.length === 0) return new Map();
  const todo = await clients.todo();
  const { data, error } = await todo.from('calendar_feeds').select('id, name').eq('user_id', userId).in('id', ids);
  if (error) return new Map();
  return new Map((data ?? []).map((row) => [row.id as string, row.name as string]));
}

export function eventEntry(
  event: Event,
  timezone: string,
  source: 'own_event' | 'feed_event',
  from: string,
): ScheduleEntry {
  const day = startDay(event, timezone);
  const allDay = isAllDay(event);
  const query = source === 'own_event' ? new URLSearchParams({ date: day, event: event.id }) : new URLSearchParams({ date: day });
  return {
    key: `${source}:${event.id}`,
    source,
    kind: 'booked',
    from,
    ref: `${source === 'own_event' ? 'todo.events' : 'todo.feed_events'}:${event.id}`,
    title: event.title,
    day,
    lastDay: endDay(event, timezone),
    startsAt: allDay ? null : event.startsAt,
    endsAt: allDay ? null : event.endsAt,
    allDay,
    location: event.location,
    detail: null,
    href: `/todo/calendar?${query}`,
    alsoIn: [],
    conflicts: [],
  };
}

type Row = Record<string, unknown>;

/** Appointments still booked, from the booking emails the linker read (lib/todo/appointments). */
async function appointmentEntries(
  userId: string,
  range: ScheduleRange,
  clients: AgendaClients,
): Promise<ScheduleEntry[]> {
  const todo = await clients.todo();
  const { data, error } = await todo
    .from('appointments')
    .select('id, title, provider, starts_on, starts_at, ends_at, location')
    .eq('user_id', userId)
    .eq('status', 'booked')
    .gte('starts_on', range.from)
    .lte('starts_on', range.to)
    .order('starts_on', { ascending: true })
    .limit(100);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[]).map((row) => appointmentEntry(row));
}

export function appointmentEntry(row: Row): ScheduleEntry {
  const id = row.id as string;
  const title = row.title as string;
  const provider = (row.provider as string | null) ?? null;
  const day = row.starts_on as string;
  const startsAt = (row.starts_at as string | null) ?? null;
  return {
    key: `appointment:${id}`,
    source: 'appointment',
    kind: 'booked',
    from: 'Booking email',
    ref: `todo.appointments:${id}`,
    title,
    day,
    lastDay: day,
    startsAt,
    endsAt: (row.ends_at as string | null) ?? null,
    allDay: false,
    location: (row.location as string | null) ?? null,
    detail: provider && !title.toLowerCase().includes(provider.toLowerCase()) ? provider : null,
    href: `/todo/calendar?${new URLSearchParams({ date: day })}`,
    alsoIn: [],
    conflicts: [],
  };
}

export function interviewEntry(row: DayContext): ScheduleEntry {
  return {
    key: row.key,
    source: 'interview',
    kind: 'booked',
    from: 'Job interviews',
    ref: row.ref,
    title: row.label,
    day: row.day,
    lastDay: row.day,
    startsAt: row.at,
    endsAt: null,
    allDay: false,
    location: null,
    detail: row.detail,
    href: row.link?.href ?? '/jobs',
    alsoIn: [],
    conflicts: [],
  };
}

/** Open todos due in the range, leaving out one put off past now and the items under a todo. */
export function taskEntries(tasks: readonly Task[], range: ScheduleRange, timezone: string, now: Date): ScheduleEntry[] {
  const entries: ScheduleEntry[] = [];
  for (const task of tasks) {
    if (task.status !== 'open' || task.parentId !== null || isSnoozed(task, now)) continue;
    const day = dueDay(task, timezone);
    if (!day || day < range.from || day > range.to) continue;
    entries.push({
      key: `task:${task.id}`,
      source: 'todo',
      kind: 'due',
      from: 'Todo',
      ref: `todo.tasks:${task.id}`,
      title: task.title,
      day,
      lastDay: day,
      startsAt: task.dueAt,
      endsAt: null,
      allDay: false,
      location: null,
      detail: task.tags.length > 0 ? task.tags.map((tag) => `#${tag}`).join(' ') : null,
      href: `/todo/all?status=all&focus=${task.id}`,
      alsoIn: [],
      conflicts: [],
    });
  }
  return entries;
}

export function itemEntry(item: AgendaItem, sources: readonly AgendaSource[]): ScheduleEntry {
  const day = item.day as string;
  return {
    key: `item:${item.key}`,
    source: 'agenda',
    kind: 'due',
    from: sources.find((source) => source.id === item.source)?.label ?? 'Agenda',
    ref: item.ref,
    title: item.title,
    day,
    lastDay: day,
    startsAt: item.at,
    endsAt: null,
    allDay: false,
    location: null,
    detail: item.detail,
    href: item.link?.href.startsWith('/') ? item.link.href : '/todo',
    alsoIn: [],
    conflicts: [],
  };
}
