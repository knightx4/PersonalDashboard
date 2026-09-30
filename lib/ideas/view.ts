import { MODULES, type ModuleId } from '@/lib/modules';
import type { IdeaRow } from '@/lib/ideas/load';

/**
 * How the ideas list is arranged, and where that choice lives.
 *
 * Both of these are query parameters on /dev/ideas rather than component
 * state, which is law 5: a list narrowed or reordered has to survive a
 * refresh, the back button, and being pasted into a note. It also means the
 * page can go on being a server component and the controls plain links, so
 * the arrangement works before JavaScript does (law 6).
 *
 * Pure and here rather than in the page, so the two rules that decide what the
 * reader sees -- which pile an idea lands in and which order it is read in --
 * are pinned by tests instead of being re-derived inside a render.
 */

export const IDEA_GROUPINGS = ['workspace', 'none'] as const;
export type IdeaGrouping = (typeof IDEA_GROUPINGS)[number];

export const IDEA_SORTS = ['score', 'newest', 'oldest'] as const;
export type IdeaSort = (typeof IDEA_SORTS)[number];

export const IDEA_GROUPING_LABEL: Record<IdeaGrouping, string> = {
  workspace: 'By workspace',
  none: 'One list',
};

export const IDEA_SORT_LABEL: Record<IdeaSort, string> = {
  score: 'Highest score first',
  newest: 'Newest first',
  oldest: 'Oldest first',
};

/** Grouping by workspace is the default: it answers "what did I think of for
 *  the job search" without anybody working a control first. */
export function parseIdeaGrouping(value: string | string[] | undefined): IdeaGrouping {
  const one = Array.isArray(value) ? value[0] : value;
  return (IDEA_GROUPINGS as readonly string[]).includes(one ?? '')
    ? (one as IdeaGrouping)
    : 'workspace';
}

/** Highest score first is the default (plan #1328): the ideas most worth
 *  shaping at the top, rather than whatever a session filed last night. */
export const DEFAULT_IDEA_SORT: IdeaSort = 'score';

export function parseIdeaSort(value: string | string[] | undefined): IdeaSort {
  const one = Array.isArray(value) ? value[0] : value;
  return (IDEA_SORTS as readonly string[]).includes(one ?? '')
    ? (one as IdeaSort)
    : DEFAULT_IDEA_SORT;
}

/**
 * How the ranking works, in the one line the page shows above the lists.
 * Kept here as text so Ask Dash can read the rule rather than work it out
 * (plan #1319). What the score measures is decision #1325.
 */
export const IDEA_RANKING_RULE =
  "Highest score first ranks ideas by Jev's score out of 100 for how much each would help what " +
  'its workspace is for, leaving out how hard it would be to build. Equal scores go newest first, ' +
  'unscored ideas go last, and a grey score is one Jev was unsure of.';

/**
 * The list in the order asked for.
 *
 * A copy, never in place: the rows come off a server render and sorting the
 * array the caller handed over would reorder every other section reading the
 * same one.
 *
 * "Oldest first" is worth keeping beside the score. An idea that has sat
 * untouched for four months is either the best thing on the list or ready to
 * be put aside, and newest-first is exactly the order that keeps it out of
 * sight.
 */
export function sortIdeas(rows: readonly IdeaRow[], sort: IdeaSort): IdeaRow[] {
  const newest = (a: IdeaRow, b: IdeaRow) => b.createdAt.localeCompare(a.createdAt);
  if (sort === 'oldest') return [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (sort === 'newest') return [...rows].sort(newest);
  // By score: the value alone, whatever Jev's confidence, since nearly every
  // score is under the 0.8 floor and leaving those out would leave the order
  // to the date. Ties and unscored ideas fall back to newest first, with every
  // unscored idea after every scored one.
  return [...rows].sort((a, b) => {
    const left = a.score?.value ?? null;
    const right = b.score?.value ?? null;
    if (left !== null && right !== null && left !== right) return right - left;
    if (left === null && right !== null) return 1;
    if (left !== null && right === null) return -1;
    return newest(a, b);
  });
}

export type IdeaGroup = {
  /** Stable across renders, for the key and for the fold's id. */
  key: string;
  label: string;
  rows: IdeaRow[];
};

/** "Everything" rather than a blank: no workspace is an answer, not a gap. */
function scopeLabel(module: ModuleId | null): string {
  if (!module) return 'Everything';
  return MODULES.find((entry) => entry.id === module)?.label ?? module;
}

/**
 * The list cut into the sections the page draws.
 *
 * Grouped by workspace, the sections come in the order the module switcher
 * lists them, with the app-wide ones first -- so the page reads the same way
 * every time rather than reshuffling itself as ideas are added. An empty
 * workspace is not a section (law 1).
 *
 * Ungrouped, it is one section with no heading, which is what `label: ''`
 * means to the caller. That is the point of the choice: a page of nine
 * headings over one idea each is worse than a list of nine.
 */
export function groupIdeas(rows: readonly IdeaRow[], grouping: IdeaGrouping): IdeaGroup[] {
  if (grouping === 'none') {
    return rows.length === 0 ? [] : [{ key: 'all', label: '', rows: [...rows] }];
  }

  const scopes: Array<ModuleId | null> = [null, ...MODULES.map((module) => module.id)];

  return scopes
    .map((scope) => ({
      key: scope ?? 'everything',
      label: scopeLabel(scope),
      rows: rows.filter((idea) => idea.module === scope),
    }))
    .filter((group) => group.rows.length > 0);
}
