import { snoozeRef, type SnoozeState } from '@/lib/core/inbox-snoozes';
import type { SnoozedItem } from '@/components/inbox/snooze';

/**
 * How the Dev inbox uses snoozes (plan #1843): a plan row is snoozed under its
 * plan_items ref and a raise under its raised_items ref. The tab's badge, the
 * Home chip and the list all filter with these, so the three agree.
 */
export const planRowRef = (id: string): string => snoozeRef('public.plan_items', id);
export const raiseRef = (id: string): string => snoozeRef('public.raised_items', id);

/** The rows left once the snoozed ones are out. */
export function withoutSnoozed<T>(
  rows: readonly T[],
  refOf: (row: T) => string,
  state: Pick<SnoozeState, 'hidden'>,
): T[] {
  return rows.filter((row) => !state.hidden.has(refOf(row)));
}

/**
 * The foot-of-list entries: each running snooze that belongs to the Dev inbox
 * and whose row can be named, soonest first.
 */
export function snoozedItems(
  state: Pick<SnoozeState, 'active'>,
  titleOf: (ref: string) => string | null,
): SnoozedItem[] {
  const items: SnoozedItem[] = [];
  for (const { ref, snoozedUntil } of state.active) {
    const title = titleOf(ref);
    if (title) items.push({ ref, title, snoozedUntil });
  }
  return items;
}
