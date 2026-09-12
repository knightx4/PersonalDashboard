import type { ReviewRow } from './load';

/** The key a row is selected by: unique across the three kinds in one queue. */
export function reviewRowKey(row: Pick<ReviewRow, 'kind' | 'id'>): string {
  return `${row.kind}-${row.id}`;
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
