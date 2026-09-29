import { splitOnRefs } from '@/lib/comments/refs';
import type { IdeaRow } from '@/lib/ideas/load';
import { isClosed, type PlanItem, type PlanKind, type PlanStatus } from '@/lib/plan/load';

/**
 * Keeping closed plan rows out of what the morning run suggests (plan #1222).
 *
 * Between 25 and 29 September the run filed the same two observations five
 * times, and by the last of them every row they named had closed: it called
 * #985, #986 and #1001 blocked when all three were done, and kept saying
 * "#1048 is still open" after it was answered. It was shown its own earlier
 * suggestions but not the state of the rows they named, so it rewrote them
 * from its own text.
 *
 * Two halves, both here so they can be tested without a model or a database.
 * Before the call, every #number the model reads carries the row's status
 * now. After it, a suggestion whose named rows have all closed is dropped
 * before it is filed or shown.
 */

/** The fields of a plan row this reads. */
export type PlanRowState = Pick<PlanItem, 'number' | 'status' | 'kind' | 'dismissedAt'>;

/** One `#number` a piece of text names, resolved against the plan as it is now. */
export type NamedRow = {
  number: number;
  /** Null when no row on the plan has that number. */
  status: PlanStatus | null;
  kind: PlanKind | null;
  dismissed: boolean;
  /** Done, dropped or dismissed: nothing about it is waiting on anybody. */
  settled: boolean;
};

/**
 * Every plan row a text names, once each, in the order first named, with its
 * status now.
 *
 * A number with no row behind it comes back with a null status and is never
 * settled: a reference the plan cannot resolve is not evidence the thing is
 * finished. Numbers are read the way the dev pages link them
 * (`lib/comments/refs.ts`), so `&#39;` and `#494a` are not rows.
 */
export function namedRows(text: string, items: readonly PlanRowState[]): NamedRow[] {
  const byNumber = new Map(items.map((item) => [item.number, item]));
  const seen = new Set<number>();
  const rows: NamedRow[] = [];

  for (const part of splitOnRefs(text)) {
    if (part.ref === null || seen.has(part.ref)) continue;
    seen.add(part.ref);
    const item = byNumber.get(part.ref);
    const dismissed = item ? item.dismissedAt !== null : false;
    rows.push({
      number: part.ref,
      status: item?.status ?? null,
      kind: item?.kind ?? null,
      dismissed,
      settled: item ? isClosed(item.status) || dismissed : false,
    });
  }
  return rows;
}

/** The rows a suggestion names, across its title and its detail. */
export function suggestionRows(
  suggestion: { title: string; detail: string | null },
  items: readonly PlanRowState[],
): NamedRow[] {
  return namedRows([suggestion.title, suggestion.detail ?? ''].join('\n'), items);
}

/**
 * The suggestions still worth filing: every one that names no row, or names
 * at least one that has not closed.
 *
 * Runs on what the model answered, before `fileNightIdeas` and
 * `withSuggestions` see it, so a suggestion about closed rows is neither
 * filed on the ideas page nor printed on the summary.
 */
export function withoutSettled<T extends { title: string; detail: string | null }>(
  suggestions: readonly T[],
  items: readonly PlanRowState[],
): T[] {
  return suggestions.filter((suggestion) => {
    const rows = suggestionRows(suggestion, items);
    return rows.length === 0 || rows.some((row) => !row.settled);
  });
}

/** How a row's state reads beside its number. A question that closed was answered. */
function stateLabel(row: NamedRow): string | null {
  if (row.status === null) return null;
  if (row.dismissed) return 'dismissed';
  if (row.status === 'done') return row.kind === 'decision' ? 'answered' : 'done';
  return row.status.replace('_', ' ');
}

/**
 * The text with each `#number` followed by the row's status now:
 * "#1048 (answered)", "#985 (done)", "#12 (blocked)".
 *
 * What the model is shown, so a line it wrote a week ago about a step that
 * has since closed says so where it names it. A number with no row behind it
 * is left as it was.
 */
export function withStatuses(text: string, items: readonly PlanRowState[]): string {
  const states = new Map(namedRows(text, items).map((row) => [row.number, stateLabel(row)]));
  return splitOnRefs(text)
    .map((part) => {
      const label = part.ref === null ? null : states.get(part.ref);
      return label ? `${part.text} (${label})` : part.text;
    })
    .join('');
}

/**
 * Whether an idea is one of the morning run's own observations: written by
 * Dash, about no workspace, out of no step.
 *
 * Those are what the run kept rewriting from its own text, so they are left
 * out of the unshaped ideas it is shown. A follow-on a session filed from a
 * step names that step, and stays in.
 */
export function isRunObservation(idea: Pick<IdeaRow, 'source' | 'module' | 'from'>): boolean {
  return idea.source === 'claude' && idea.module === null && idea.from === null;
}
