import { isBackFromSnooze, isSnoozed, snoozeIndex, type InboxSnooze } from '@/lib/core/inbox-snoozes';
import type { TodayItem, TodayKind } from './today';

/**
 * Snoozing on the Goals Inbox (plan #1844). A row is hidden by the ref of the
 * thing it is about, through the shared check in lib/core/inbox-snoozes.ts.
 *
 * Suggestions, "Did you go?" and area plans are rows of tables a snooze does
 * not name, so they stay; so do Dash's own steps and the runs' questions.
 */

const TABLES: Partial<Record<TodayKind, 'goals.items' | 'public.raised_items'>> = {
  step: 'goals.items',
  question: 'goals.items',
  ask: 'goals.items',
  rhythm: 'goals.items',
  breakdown: 'goals.items',
  close: 'goals.items',
  park: 'goals.items',
  flag: 'public.raised_items',
};

/** The ref a row is snoozed under, or null for a kind that cannot be snoozed. */
export function snoozeRefOf(kind: TodayKind, id: string): string | null {
  const table = TABLES[kind];
  return table ? `${table}:${id}` : null;
}

/**
 * The rows still showing: those with no snooze in force. A row whose snooze
 * ran out unchanged comes back marked `backFromSnooze`. `stamps` holds each
 * snoozed row's change stamp now (loadRowStamps); a row with none is shown.
 */
export function withoutSnoozed(
  items: readonly TodayItem[],
  snoozes: readonly InboxSnooze[],
  stamps: ReadonlyMap<string, string>,
  now: Date,
): TodayItem[] {
  const index = snoozeIndex([...snoozes]);
  const shown: TodayItem[] = [];
  for (const item of items) {
    const ref = snoozeRefOf(item.kind, item.id);
    const snooze = ref ? index.get(ref) : undefined;
    const stamp = ref ? stamps.get(ref) : undefined;
    if (!snooze || !stamp) {
      shown.push(item);
    } else if (!isSnoozed(snooze, stamp, now)) {
      shown.push(isBackFromSnooze(snooze, stamp, now) ? { ...item, backFromSnooze: true } : item);
    }
  }
  return shown;
}
