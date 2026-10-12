/**
 * Inbox snoozes (plan #1842). A snooze hides one row of the Dev or Goals inbox
 * until a day, and stops hiding it as soon as the row underneath changes, so a
 * snooze never covers a new answer or a new question.
 */

/** The rows an inbox can snooze, named by ref (schema.table:id). */
export const SNOOZABLE_TABLES = ['public.plan_items', 'goals.items', 'public.raised_items'] as const;

/** A row of core.inbox_snoozes, as the inboxes read it. */
export type InboxSnooze = {
  ref: string;
  snoozed_until: string;
  row_updated_at: string;
};

/**
 * Whether the snooze still hides its row. `rowStamp` is the row's change stamp
 * now: its updated_at, or the time of its newest thread turn when that is
 * later, since a comment does not touch the row itself. It hides while `now`
 * is before snoozed_until and the stamp has not moved past the one recorded.
 * No snooze hides nothing.
 */
export function isSnoozed(
  snooze: Pick<InboxSnooze, 'snoozed_until' | 'row_updated_at'> | null | undefined,
  rowStamp: string | Date,
  now: Date = new Date(),
): boolean {
  if (!snooze) return false;
  if (now.getTime() >= new Date(snooze.snoozed_until).getTime()) return false;
  return new Date(rowStamp).getTime() <= new Date(snooze.row_updated_at).getTime();
}

/**
 * Whether a row is back from a snooze that ran out and not because it changed,
 * for the "back from snooze" mark. A changed row is just a changed row.
 */
export function isBackFromSnooze(
  snooze: Pick<InboxSnooze, 'snoozed_until' | 'row_updated_at'> | null | undefined,
  rowStamp: string | Date,
  now: Date = new Date(),
): boolean {
  if (!snooze) return false;
  if (now.getTime() < new Date(snooze.snoozed_until).getTime()) return false;
  return new Date(rowStamp).getTime() <= new Date(snooze.row_updated_at).getTime();
}

/** The key a snooze list is looked up by. */
export function snoozeIndex(snoozes: InboxSnooze[]): Map<string, InboxSnooze> {
  return new Map(snoozes.map((s) => [s.ref, s]));
}
