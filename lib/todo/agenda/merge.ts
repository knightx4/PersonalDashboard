import {
  addDays,
  bucketFor,
  dueDay,
  isSnoozed,
  todayIn,
  type Bucket,
  type Task,
} from '@/lib/todo/tasks/model';
import type { AgendaItem, DayContext } from '@/lib/todo/agenda/sources';

/**
 * Putting the agenda together.
 *
 * PURE. It takes already-fetched lists, an explicit clock and an explicit
 * timezone, and returns the piles. No client, no I/O, no `Date.now()` inside --
 * a function that reads the clock itself cannot be tested for "overdue", and
 * one that reads the timezone itself cannot be tested for "which day is this".
 *
 * Everything that could be wrong about an agenda is a table test next door.
 */

export interface AgendaEntry {
  kind: 'task' | 'item';
  /** Stable within the agenda, for React keys and nothing else. */
  key: string;
  task?: Task;
  item?: AgendaItem;
  /** The label of what this is about, when the caller resolved one. */
  anchor?: { label: string; href: string } | null;
}

export interface AgendaPile {
  bucket: Bucket;
  entries: AgendaEntry[];
  /**
   * What is already in these days -- interviews, and whatever else turns out
   * to be an appointment rather than a task. Shown above the entries, without
   * a checkbox, because you do not tick off a meeting.
   */
  context: DayContext[];
}

export interface MergeInput {
  tasks: Task[];
  items: AgendaItem[];
  context?: DayContext[];
  /** Keys of source items deferred or dismissed, and until when. */
  dismissals: Map<string, { until: string | null }>;
  anchors?: Map<string, { label: string; href: string }>;
  timezone: string;
  now: Date;
  horizonDays: number;
}

const ORDER: Bucket[] = ['overdue', 'today', 'soon', 'later', 'someday'];

/**
 * Whether a dismissal still hides its item.
 *
 * A null `until` is "for good"; a date in the future is "Later"; a date in the
 * past is a deferral that has run out, and the item comes back. That is the
 * same distinction the reminders table draws with due_at and completed_at, and
 * the same one job_search's dismissal tables already draw.
 */
export function stillHidden(
  dismissal: { until: string | null } | undefined,
  now: Date,
): boolean {
  if (!dismissal) return false;
  if (dismissal.until === null) return true;
  return new Date(dismissal.until) > now;
}

export function mergeAgenda(input: MergeInput): AgendaPile[] {
  const { timezone, now } = input;
  const today = todayIn(timezone, now);
  const horizon = addDays(today, input.horizonDays);

  const piles = new Map<Bucket, AgendaEntry[]>();
  const push = (bucket: Bucket, entry: AgendaEntry) => {
    const pile = piles.get(bucket) ?? [];
    pile.push(entry);
    piles.set(bucket, pile);
  };

  for (const task of input.tasks) {
    if (task.status !== 'open') continue;
    if (isSnoozed(task, now)) continue;

    push(bucketOf(dueDay(task, timezone), today, horizon), {
      kind: 'task',
      key: `task:${task.id}`,
      task,
      anchor: input.anchors?.get(task.id) ?? null,
    });
  }

  for (const item of input.items) {
    if (stillHidden(input.dismissals.get(item.key), now)) continue;

    push(bucketOf(item.day, today, horizon), {
      kind: 'item',
      key: `item:${item.key}`,
      item,
    });
  }

  const contextByBucket = new Map<Bucket, DayContext[]>();
  for (const entry of input.context ?? []) {
    // An appointment in the past is not overdue -- it is over. Nothing is owed
    // and there is nothing left to do about it, which is the whole meaning of
    // the overdue pile. The window reaches a year back so that a genuinely
    // late reminder cannot hide, and every interview in that year came back
    // with it: months of attended interviews stacked under a red "Overdue"
    // heading, telling a person they were late for things they had already
    // been to.
    if (entry.day < today) continue;

    const bucket = bucketOf(entry.day, today, horizon);
    contextByBucket.set(bucket, [...(contextByBucket.get(bucket) ?? []), entry]);
  }

  // A pile with only context and nothing to do is still worth showing: "you
  // have an interview on Thursday and nothing else" is an answer, and an empty
  // Thursday that silently omits the interview is not.
  const buckets = ORDER.filter(
    (bucket) => (piles.get(bucket)?.length ?? 0) > 0 || (contextByBucket.get(bucket)?.length ?? 0) > 0,
  );

  return buckets.map((bucket) => ({
    bucket,
    entries: [...(piles.get(bucket) ?? [])].sort(compare),
    context: [...(contextByBucket.get(bucket) ?? [])].sort((a, b) =>
      (a.at ?? a.day) < (b.at ?? b.day) ? -1 : 1,
    ),
  }));
}

/**
 * Which pile a day belongs in.
 *
 * Shares the rule with bucketFor rather than restating it: a task and a
 * reminder due on the same day must land in the same pile, and two copies of
 * "is this soon" would eventually disagree about it.
 */
function bucketOf(day: string | null, today: string, horizon: string): Bucket {
  if (day === null) return 'someday';
  if (day < today) return 'overdue';
  if (day === today) return 'today';
  if (day <= horizon) return 'soon';
  return 'later';
}

/**
 * Inside a pile: pinned first, then by day, then by clock, then by title.
 *
 * Your own tasks come before source items on the same day and the same clock.
 * The agenda is a list of what you decided to do, with what the rest of the
 * account noticed underneath it -- not the other way round.
 */
function compare(a: AgendaEntry, b: AgendaEntry): number {
  const pinnedA = a.task?.pinned ?? false;
  const pinnedB = b.task?.pinned ?? false;
  if (pinnedA !== pinnedB) return pinnedA ? -1 : 1;

  const dayA = a.kind === 'task' ? (a.task?.dueOn ?? dayOfInstant(a.task?.dueAt)) : a.item!.day;
  const dayB = b.kind === 'task' ? (b.task?.dueOn ?? dayOfInstant(b.task?.dueAt)) : b.item!.day;
  if (dayA !== dayB) {
    if (dayA === null) return 1;
    if (dayB === null) return -1;
    return dayA < dayB ? -1 : 1;
  }

  const atA = a.kind === 'task' ? (a.task?.dueAt ?? null) : a.item!.at;
  const atB = b.kind === 'task' ? (b.task?.dueAt ?? null) : b.item!.at;
  if ((atA === null) !== (atB === null)) return atA === null ? 1 : -1;
  if (atA && atB && atA !== atB) return atA < atB ? -1 : 1;

  if (a.kind !== b.kind) return a.kind === 'task' ? -1 : 1;

  const titleA = a.task?.title ?? a.item?.title ?? '';
  const titleB = b.task?.title ?? b.item?.title ?? '';
  return titleA.localeCompare(titleB);
}

/** The UTC day of an instant, for ordering only. Display uses the real zone. */
function dayOfInstant(iso: string | null | undefined): string | null {
  return iso ? iso.slice(0, 10) : null;
}

/** Re-exported so callers do not need two imports to bucket one task. */
export { bucketFor };
