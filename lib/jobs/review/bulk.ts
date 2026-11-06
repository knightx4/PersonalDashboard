import { REVIEW_VIEWS, type ReviewCounts, type ReviewRow, type ReviewView } from './load';

/** The key a row is selected by: unique across the three kinds in one queue. */
export function reviewRowKey(row: Pick<ReviewRow, 'kind' | 'id'>): string {
  return `${row.kind}-${row.id}`;
}

/** What the row is, in a few words: the tick box's name, the toast's and the Inbox row's. */
export function reviewRowLabel(row: ReviewRow): string {
  if (row.kind === 'message') return row.subject?.trim() || 'message without a subject';
  if (row.kind === 'application') return `${row.companyName} · ${row.roleTitle}`;
  return row.summary?.trim() || `${row.eventKind} at ${row.companyName}`;
}

/** Which kind of row each narrowed view of the queue keeps. */
const VIEW_KIND: Record<Exclude<ReviewView, 'all'>, ReviewRow['kind']> = {
  messages: 'message',
  applications: 'application',
  events: 'event',
};

export type ReviewViewShown = { id: ReviewView; label: string; count: number };

/**
 * The views the Jobs Inbox offers over its imports to check (plan
 * #1496.7.3), with their counts: All, then each kind that has something
 * waiting. None when every item is one kind, since narrowing would change
 * nothing.
 */
export function reviewViewsShown(counts: ReviewCounts): ReviewViewShown[] {
  const views: ReviewViewShown[] = REVIEW_VIEWS.map((view) => ({ id: view.id, label: view.label, count: counts[view.id] }));
  const kinds = views.filter((view) => view.id !== 'all' && view.count > 0);
  return kinds.length > 1 ? views.filter((view) => view.id === 'all' || view.count > 0) : [];
}

/**
 * The view the Inbox draws: the one asked for when it is offered, else All,
 * so an address naming a kind with nothing waiting still lists everything.
 */
export function reviewViewIn(view: ReviewView, counts: ReviewCounts): ReviewView {
  return reviewViewsShown(counts).some((shown) => shown.id === view) ? view : 'all';
}

/** The rows a view keeps, in the queue's order. */
export function reviewRowsInView<T extends Pick<ReviewRow, 'kind'>>(rows: readonly T[], view: ReviewView): T[] {
  return view === 'all' ? [...rows] : rows.filter((row) => row.kind === VIEW_KIND[view]);
}

/**
 * What each verb in the jobs review queue's action bar would touch.
 *
 * Messages are dismissed and events are acknowledged, so a selection is split
 * by kind and each verb is labelled with its own count, the same rule #232
 * settled for the shopping queue. Inferred applications take neither verb in
 * bulk: confirming one is a decision about that pursuit, so its row keeps its
 * own buttons.
 */
export function jobsSelectionTargets(
  rows: readonly ReviewRow[],
  isSelected: (key: string) => boolean,
): { messageIds: string[]; eventIds: string[] } {
  const messageIds: string[] = [];
  const eventIds: string[] = [];

  for (const row of rows) {
    if (!isSelected(reviewRowKey(row))) continue;
    if (row.kind === 'message') messageIds.push(row.id);
    else if (row.kind === 'event') eventIds.push(row.id);
  }

  return { messageIds, eventIds };
}
