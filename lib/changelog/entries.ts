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
  /**
   * The feature this shipped under, when it shipped under one.
   *
   * The top of the plan tree above the step, not its immediate parent: the
   * question "what did this belong to" is answered by the feature, and a
   * sub-sub-step's parent is another step nobody thinks of as a thing.
   * Null for a note, which belongs to no feature, and for a feature itself.
   */
  issue: ChangelogIssue | null;
};

export type ChangelogIssue = { id: string; number: number; title: string };

/** Enough of a plan row to walk up from a step to the feature above it. */
export type PlanParentRow = {
  id: string;
  number: number;
  title: string;
  parentId: string | null;
};

export type ChangelogDay = {
  day: string;
  entries: ChangelogEntry[];
};

/**
 * How the page is grouped. In the URL, so a grouping is a link somebody can
 * keep -- law 5.
 */
export const CHANGELOG_GROUPINGS = ['day', 'issue', 'commit'] as const;
export type ChangelogGrouping = (typeof CHANGELOG_GROUPINGS)[number];

export function isChangelogGrouping(value: string): value is ChangelogGrouping {
  return (CHANGELOG_GROUPINGS as readonly string[]).includes(value);
}

export const CHANGELOG_GROUPING_LABEL: Record<ChangelogGrouping, string> = {
  day: 'By day',
  issue: 'By issue',
  commit: 'By commit',
};

export type ChangelogGroup = {
  key: string;
  /** What the heading is, so the page knows how to set it. */
  kind: ChangelogGrouping | 'loose';
  /**
   * The heading. A `YYYY-MM-DD` for a day and a sha for a commit, both of
   * which the page formats -- everything else is final text.
   */
  label: string;
  /** The `#12` of a feature. Null everywhere else. */
  number: number | null;
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
 *
 * A decision is excluded for the first reason rather than the second. Answering
 * a question closes it `done`, but what changed is the plan, not the app: the
 * plan page calls that state "answered" and not "done" for exactly this reason.
 * They are also the only closed rows carrying no commit, because there is no
 * commit to carry — which is what the line would have been read for.
 */
export function planEntries(
  items: readonly PlanItem[],
  /**
   * Every plan row, thin, so a step can name the feature above it. The steps
   * on this page are the closed ones and their features usually are not, so
   * the ancestors cannot be found among the entries themselves.
   */
  parents: readonly PlanParentRow[] = [],
): ChangelogEntry[] {
  const byId = new Map(parents.map((row) => [row.id, row]));

  return items
    .filter(
      (item) => item.kind !== 'decision' && item.status === 'done' && item.completedAt !== null,
    )
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
      issue: featureAbove(item.parentId, byId),
    }));
}

/**
 * The feature at the top of the tree above a step.
 *
 * Walks to the root rather than stopping at the parent, because "what did this
 * belong to" is answered by the feature and a sub-sub-step's parent is another
 * step. Guards against a cycle by refusing to visit a row twice: a parent
 * chain is data, and data can be wrong in ways that hang a page.
 */
function featureAbove(
  parentId: string | null,
  byId: ReadonlyMap<string, PlanParentRow>,
): ChangelogIssue | null {
  const seen = new Set<string>();
  let current = parentId;
  let top: PlanParentRow | null = null;

  while (current && !seen.has(current)) {
    seen.add(current);
    const row = byId.get(current);
    if (!row) break;
    top = row;
    current = row.parentId;
  }

  return top ? { id: top.id, number: top.number, title: top.title } : null;
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
      // A note belongs to no feature. It is its own small issue, and grouping
      // by issue says exactly that rather than inventing a parent for it.
      issue: null,
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
export function changelogEntries(input: {
  plan: readonly PlanItem[];
  planParents?: readonly PlanParentRow[];
  notes: readonly FeedbackRow[];
}): ChangelogEntry[] {
  return [...planEntries(input.plan, input.planParents), ...noteEntries(input.notes)].sort(
    (a, b) => b.at.localeCompare(a.at) || a.key.localeCompare(b.key),
  );
}

export function buildChangelog(input: {
  plan: readonly PlanItem[];
  planParents?: readonly PlanParentRow[];
  notes: readonly FeedbackRow[];
}): ChangelogDay[] {
  const days: ChangelogDay[] = [];
  for (const entry of changelogEntries(input)) {
    const last = days[days.length - 1];
    if (last && last.day === entry.day) last.entries.push(entry);
    else days.push({ day: entry.day, entries: [entry] });
  }
  return days;
}

/**
 * The entries under headings, in one of three ways.
 *
 * By day is the default and what the page has always done: a changelog is
 * read as "what landed lately". The other two answer questions the day
 * grouping buries.
 *
 * By issue puts a feature's steps together, which is the only way to see that
 * six lines spread over three days were one piece of work. A step's issue is
 * the feature at the top of the tree above it; a feature that shipped itself,
 * and a note, belong to nothing above them and stand as their own line.
 *
 * By commit puts everything one commit closed together. A batch closes several
 * rows against one sha and they scatter across a day; this is how you read the
 * commit back as the thing it was.
 *
 * Groups are ordered by their newest entry, never by name, so the top of the
 * page is the most recent work whichever way it is grouped.
 */
export function groupChangelog(
  entries: readonly ChangelogEntry[],
  grouping: ChangelogGrouping,
): ChangelogGroup[] {
  const groups = new Map<string, ChangelogGroup>();

  for (const entry of entries) {
    const of = groupOf(entry, grouping);
    const existing = groups.get(of.key);
    if (existing) existing.entries.push(entry);
    else groups.set(of.key, { ...of, entries: [entry] });
  }

  // Insertion order is already newest-first when the entries are, because a
  // group is created by its own newest entry. Sorting explicitly anyway, so
  // this does not silently depend on the caller having sorted.
  return [...groups.values()].sort(
    (a, b) => newestOf(b).localeCompare(newestOf(a)) || a.key.localeCompare(b.key),
  );
}

function newestOf(group: ChangelogGroup): string {
  return group.entries.reduce((newest, entry) => (entry.at > newest ? entry.at : newest), '');
}

function groupOf(
  entry: ChangelogEntry,
  grouping: ChangelogGrouping,
): Omit<ChangelogGroup, 'entries'> {
  if (grouping === 'day') {
    return { key: entry.day, kind: 'day', label: entry.day, number: null };
  }

  if (grouping === 'commit') {
    // Its own heading rather than dropped or quietly pooled with the rest: a
    // row that closed without a commit is a real thing that happened, and
    // saying so is law 2.
    if (!entry.commitSha) {
      return { key: 'no-commit', kind: 'loose', label: 'Closed without a commit', number: null };
    }
    return { key: entry.commitSha, kind: 'commit', label: entry.commitSha, number: null };
  }

  if (entry.issue) {
    return {
      key: `issue-${entry.issue.id}`,
      kind: 'issue',
      label: entry.issue.title,
      number: entry.issue.number,
    };
  }

  // A feature, or a note: it is the issue, so it heads its own group of one.
  return { key: entry.key, kind: 'issue', label: entry.title, number: entry.number };
}
