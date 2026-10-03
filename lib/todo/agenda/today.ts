import type { Bucket } from '@/lib/todo/tasks/model';
import type { AgendaEntry, AgendaPile } from '@/lib/todo/agenda/merge';
import type { DayContext } from '@/lib/todo/agenda/sources';

/**
 * What "today" is, read off the merged agenda.
 *
 * PURE. Home's Today section and the Todo list's Overdue and Today piles are
 * the same list (CORE-AND-DASH-SPEC Part 4: "Home's Today section reads this
 * list instead of assembling its own"), so the rule for which piles count as
 * today lives here once rather than as a filter inside a page.
 *
 * The undated pile is not today. TODO-SPEC puts "the things due today" on
 * Home, and "On you, no date" sits under the dated piles because a date is
 * what makes something more pressing than the rest. Home links to /todo,
 * where that pile is.
 */

/** The piles that make up today, in the order the agenda draws them. */
export const TODAY_BUCKETS: readonly Bucket[] = ['overdue', 'today'];

export function isTodayBucket(bucket: Bucket): boolean {
  return TODAY_BUCKETS.includes(bucket);
}

export interface TodayEntry {
  bucket: Bucket;
  entry: AgendaEntry;
}

export interface TodaySlice {
  /** The first `cap` things to do today, overdue first. */
  due: TodayEntry[];
  /** How many more there are past the cap, for "+N more". */
  more: number;
  /** What today already holds (an event, an interview), capped the same. */
  happening: DayContext[];
}

/**
 * Every entry the agenda lists for today, overdue first, in pile order.
 * This is exactly what the Todo list draws under its Overdue and Today
 * headings.
 */
export function todayEntries(piles: readonly AgendaPile[]): TodayEntry[] {
  return piles
    .filter((pile) => isTodayBucket(pile.bucket))
    .flatMap((pile) => pile.entries.map((entry) => ({ bucket: pile.bucket, entry })));
}

/**
 * Today, cut to fit Home. Appointments are today's only: an appointment in
 * the past is over rather than late, and the merge already leaves those out.
 */
export function todaySlice(piles: readonly AgendaPile[], cap = 5): TodaySlice {
  const all = todayEntries(piles);
  const due = all.slice(0, cap);
  return {
    due,
    more: all.length - due.length,
    happening: piles
      .filter((pile) => pile.bucket === 'today')
      .flatMap((pile) => pile.context)
      .slice(0, cap),
  };
}
