/**
 * What a task is, and which pile it lands in.
 *
 * Pure, and deliberately separate from the queries: everything that could be
 * wrong about a list of tasks -- a snooze that has expired, an overdue item
 * sorting after a future one, a day boundary landing in the wrong timezone --
 * is decided here and tested without a database. Same shape as
 * lib/vault/sync/plan.ts, for the same reason.
 */

export type TaskStatus = 'open' | 'done' | 'dropped';

/**
 * Where an unplaced thing sorts: after everything anyone has put in an order.
 *
 * Infinity rather than a large number, so the two cases can never be confused
 * and no list is long enough to reach it.
 */
export const UNPLACED = Number.POSITIVE_INFINITY;

/** How a task sorts against the hand-placed ones, whether or not it is one. */
export function rankOf(task: Pick<Task, 'position'>): number {
  return task.position ?? UNPLACED;
}

export interface Task {
  id: string;
  title: string;
  body: string | null;
  status: TaskStatus;
  /** A calendar day, YYYY-MM-DD. Never an instant. */
  dueOn: string | null;
  /** An instant, when the task is pinned to a clock rather than a day. */
  dueAt: string | null;
  pinned: boolean;
  snoozedUntil: string | null;
  completedAt: string | null;
  createdAt: string;
  /** Where you put it by hand within its pile. Null until you move one. */
  position: number | null;
}

/** The piles the list is shown in, in the order they matter. */
export type Bucket = 'overdue' | 'today' | 'soon' | 'later' | 'someday';

export const BUCKET_LABELS: Record<Bucket, string> = {
  overdue: 'Overdue',
  today: 'Today',
  soon: 'This week',
  later: 'Later',
  someday: 'Someday',
};

/** How far "This week" reaches. Seven days, which is what a week is. */
export const SOON_DAYS = 7;

/**
 * How far "Later" pushes a snoozed task.
 *
 * The same seven days the job side already means by "Later"
 * (`SNOOZE_DAYS` in lib/jobs/today/load.ts). Long enough that deferring is a
 * decision rather than a way of clearing the screen.
 */
export const SNOOZE_DAYS = 7;

/**
 * Today, as a calendar day, in a given zone.
 *
 * Taking the zone as an argument rather than reading it is what makes "which
 * day is this" testable at all. lib/money.ts has the same function for the
 * commerce side; this one is here so the todo module does not depend on the
 * shopping module to know what day it is.
 */
export function todayIn(timezone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** A calendar day `days` after `day`. Pure string arithmetic on a UTC date. */
export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The days a form can name in words rather than as a date. */
export const RELATIVE_DAYS = ['today', 'tomorrow'] as const;

export type RelativeDay = (typeof RELATIVE_DAYS)[number];

/**
 * A day named in words, as the date it means.
 *
 * The add form on /todo is rendered by the server and handed the account's
 * today, so its chips send real dates. The capture panel is mounted in the
 * shell, which is not handed one, and the browser's own today is a different
 * day for anyone whose list lives in another zone -- so its chips send the
 * word and this turns it into a date on the server, where the zone is known.
 * Anything else comes back as it went in, so a real date passes straight
 * through to the date validation and so does a wrong one.
 */
export function resolveRelativeDay(value: string, today: string): string {
  if (value === 'today') return today;
  if (value === 'tomorrow') return addDays(today, 1);
  return value;
}

/**
 * The calendar day a task is due on, in the reader's zone.
 *
 * A `due_on` is already a day and is returned as written -- converting it
 * through a zone is exactly the bug the two columns exist to prevent. A
 * `due_at` is an instant and genuinely has to be asked which day it falls on
 * for this reader.
 */
export function dueDay(task: Task, timezone: string): string | null {
  if (task.dueOn) return task.dueOn;
  if (task.dueAt) return todayIn(timezone, new Date(task.dueAt));
  return null;
}

/** Whether a task is hidden right now because it was deferred. */
export function isSnoozed(task: Task, now: Date): boolean {
  return task.snoozedUntil !== null && new Date(task.snoozedUntil) > now;
}

export function bucketFor(task: Task, timezone: string, now: Date): Bucket {
  const day = dueDay(task, timezone);
  if (day === null) return 'someday';

  const today = todayIn(timezone, now);
  if (day < today) return 'overdue';
  if (day === today) return 'today';
  if (day <= addDays(today, SOON_DAYS)) return 'soon';
  return 'later';
}

/**
 * The open list, bucketed and ordered.
 *
 * Ordering inside a bucket: what you placed by hand, in the order you placed
 * it, then everything else -- pinned first, then by due day, then by when it
 * was written.
 *
 * Your order wins over the pin, which is the point of having it: the automatic
 * rules know which day a thing is due and cannot know which of four things due
 * today you mean to do first. A pin still floats anything you have not placed.
 *
 * Snoozed tasks are dropped entirely rather than shown greyed out. "Later"
 * means later; a list that still shows what you deferred has not deferred it.
 */
export function bucketTasks(
  tasks: Task[],
  opts: { timezone: string; now?: Date },
): Array<{ bucket: Bucket; tasks: Task[] }> {
  const now = opts.now ?? new Date();
  const piles = new Map<Bucket, Task[]>();

  for (const task of tasks) {
    if (task.status !== 'open') continue;
    if (isSnoozed(task, now)) continue;

    const bucket = bucketFor(task, opts.timezone, now);
    const pile = piles.get(bucket) ?? [];
    pile.push(task);
    piles.set(bucket, pile);
  }

  const order: Bucket[] = ['overdue', 'today', 'soon', 'later', 'someday'];

  return order
    .filter((bucket) => (piles.get(bucket)?.length ?? 0) > 0)
    .map((bucket) => ({
      bucket,
      tasks: [...(piles.get(bucket) ?? [])].sort((a, b) => compare(a, b, opts.timezone)),
    }));
}

function compare(a: Task, b: Task, timezone: string): number {
  // Placed before unplaced, and placed among themselves in the order given.
  // First rather than after the pin so that a hand-placed order is not quietly
  // overruled by one; see bucketTasks.
  const rankA = rankOf(a);
  const rankB = rankOf(b);
  if (rankA !== rankB) return rankA - rankB;

  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;

  const dayA = dueDay(a, timezone);
  const dayB = dueDay(b, timezone);
  if (dayA !== dayB) {
    if (dayA === null) return 1;
    if (dayB === null) return -1;
    return dayA < dayB ? -1 : 1;
  }

  // Same day: a task with a clock on it comes before one that merely happens
  // that day, because the clock is the thing that can be missed.
  if ((a.dueAt === null) !== (b.dueAt === null)) return a.dueAt === null ? 1 : -1;
  if (a.dueAt && b.dueAt && a.dueAt !== b.dueAt) return a.dueAt < b.dueAt ? -1 : 1;

  return a.createdAt < b.createdAt ? -1 : 1;
}
