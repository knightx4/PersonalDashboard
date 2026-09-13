import type { ReviewRow } from './load';

/**
 * What each verb in the review queue's action bar would touch.
 *
 * The queue interleaves orders and emails and they take different verbs, so
 * a selection is split rather than refused: per #232 every verb that applies
 * to any of the selection is offered, each labelled with its own count, and
 * neither touches the other's rows. A selection of only emails therefore has
 * no order ids at all, and the bar shows no Confirm.
 */
export function reviewSelectionTargets(
  rows: readonly ReviewRow[],
  isSelected: (key: string) => boolean,
): { orderIds: string[]; emailIds: string[] } {
  const orderIds: string[] = [];
  const emailIds: string[] = [];

  for (const row of rows) {
    if (!isSelected(row.id)) continue;
    if (row.kind === 'order') orderIds.push(row.orderId);
    else emailIds.push(row.messageId);
  }

  return { orderIds, emailIds };
}
