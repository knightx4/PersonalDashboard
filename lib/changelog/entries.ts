import { MODULES, type ModuleId } from '@/lib/modules';
import type { FeedbackRow } from '@/lib/feedback/load';
import type { PlanItem } from '@/lib/plan/load';

/**
 * What has shipped, read.
 *
 * The three lists in the dev workspace all say what is going to happen. This
 * says what already did, and it is built out of the app's own closed rows
 * rather than out of the git log — the answer recorded on plan step #122.
 * Both `plan_items` and `feedback_items` already carry the commit that shipped
 * them and when they closed, so a changelog line needs nothing migrated and
 * nothing maintained, and every line can point back at the row it came from.
 *
 * The cost of that answer, written down where it will be found: work done off
 * the plan and outside the notes queue — a refactor, a UI sweep — never
 * appears here at all.
 *
 * Pure, in the shape `lib/plan/tree.ts` has: rows in, what the page renders
 * out. The rule about what appears lives here, tested, rather than inside JSX.
 */

/** Which of the two lists a line came from. */
export type ChangelogSource = 'plan' | 'note';

export type ChangelogEntry = {
  /** Stable across a render, and unique across both sources. */
  key: string;
  source: ChangelogSource;
  /** The row it came from, to link back with. */
  id: string;
  /** The plan step's `#12`. Null for a note, which has no number. */
  number: number | null;
  /** When it closed. ISO, as the row stored it. */
  at: string;
  /** The day it landed, `YYYY-MM-DD`. */
  day: string;
  /** The workspace it belonged to, or null for the app as a whole. */
  module: ModuleId | null;
  title: string;
  /** The step's detail, or the note's resolution note. */
  detail: string | null;
  commitSha: string | null;
};

export type ChangelogDay = {
  day: string;
  entries: ChangelogEntry[];
};

/**
 * The workspace a path belongs to, or null when it belongs to none.
 *
 * A note carries the page it was filed from and not a module, because the
 * button that files it is in the header of every workspace. The path is the
 * only thing that says where the person was standing.
 */
export function moduleForPath(path: string | null): ModuleId | null {
  if (!path) return null;
  const match = MODULES.find(
    (module) => path === module.prefix || path.startsWith(`${module.prefix}/`),
  );
  return match?.id ?? null;
}

/**
 * A closed plan step is a line; anything else is not.
 *
 * Dropped steps are excluded because a step decided against never shipped, and
 * a changelog that lists it is claiming otherwise. A `done` row with no
 * `completed_at` is excluded for the plainer reason that there is no day to
 * file it under — the trigger sets that column from the status, so it means a
 * row edited around the app rather than closed through it.
 */
export function planEntries(items: readonly PlanItem[]): ChangelogEntry[] {
  return items
    .filter((item) => item.status === 'done' && item.completedAt !== null)
    .map((item) => ({
      key: `plan-${item.id}`,
      source: 'plan' as const,
      id: item.id,
      number: item.number,
      at: item.completedAt as string,
      day: dayOf(item.completedAt as string),
      module: item.module,
      title: item.title,
      detail: item.detail,
      commitSha: item.commitSha,
    }));
}

/**
 * A fixed note is a line. A declined one is not — same reason a dropped step
 * is not: nothing shipped. Nor is a note still open, blocked or merely
 * planned, none of which have happened yet.
 */
export function noteEntries(rows: readonly FeedbackRow[]): ChangelogEntry[] {
  return rows
    .filter((row) => row.status === 'done' && row.completedAt !== null)
    .map((row) => ({
      key: `note-${row.id}`,
      source: 'note' as const,
      id: row.id,
      number: null,
      at: row.completedAt as string,
      day: dayOf(row.completedAt as string),
      module: moduleForPath(row.pagePath),
      title: row.body,
      detail: row.resolutionNote,
      commitSha: row.commitSha,
    }));
}

/**
 * The day a timestamp landed on, as the row stored it.
 *
 * The date part of the UTC instant, which is what `lib/jobs/activity` already
 * does for the activity feed. Not the account's timezone: a heading a few
 * hours out on something shipped late in the evening is a smaller wrong than
 * two lists in this app grouping the same instant under different days.
 */
function dayOf(at: string): string {
  return at.slice(0, 10);
}

/**
 * Both lists merged into days, newest first, each day's entries newest first.
 *
 * A day with nothing in it never appears, because days are built from the
 * entries rather than counted off a calendar — most days nothing ships, and a
 * changelog of empty headings is a worse read than a short one.
 */
export function buildChangelog(input: {
  plan: readonly PlanItem[];
  notes: readonly FeedbackRow[];
}): ChangelogDay[] {
  const entries = [...planEntries(input.plan), ...noteEntries(input.notes)].sort(
    (a, b) => b.at.localeCompare(a.at) || a.key.localeCompare(b.key),
  );

  const days: ChangelogDay[] = [];
  for (const entry of entries) {
    const last = days[days.length - 1];
    if (last && last.day === entry.day) last.entries.push(entry);
    else days.push({ day: entry.day, entries: [entry] });
  }
  return days;
}
