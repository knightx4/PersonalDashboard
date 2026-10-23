import type { ReviewRow } from './load';

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

/** How many review items the Jobs Inbox lists before it opens the rest in Review. */
export const INBOX_REVIEW_LIMIT = 5;

/**
 * The head of the review queue the Jobs Inbox lists (plan #2502.2), and how
 * many it leaves for Review. `total` is the queue's own count, so the rest
 * is right even when the loader hands over fewer rows than it counted.
 */
export function inboxReviewHead<T>(
  rows: readonly T[],
  total: number,
): { shown: T[]; rest: number } {
  const shown = rows.slice(0, INBOX_REVIEW_LIMIT);
  return { shown, rest: Math.max(total - shown.length, 0) };
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
