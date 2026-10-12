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

/** The start of a local day, `plusDays` after the one `from` falls in. */
export function localDayStart(from: Date, plusDays = 0): Date {
  return new Date(from.getFullYear(), from.getMonth(), from.getDate() + plusDays);
}

/** The moment "tomorrow" and "next week" mean: the start of that local day. */
export function snoozeChoices(now: Date): { tomorrow: Date; nextWeek: Date } {
  return { tomorrow: localDayStart(now, 1), nextWeek: localDayStart(now, 7) };
}

/** A picked `YYYY-MM-DD` as the start of that local day, or null when it is not a day. */
export function pickedDayStart(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, m, d] = match.map(Number);
  const day = new Date(y, m - 1, d);
  return day.getMonth() === m - 1 && day.getDate() === d ? day : null;
}

/** The ref a snooze is stored under: `schema.table:id`. */
export function snoozeRef(table: (typeof SNOOZABLE_TABLES)[number], id: string): string {
  return `${table}:${id}`;
}

/** Splits a ref into its table and id, or null when it is not a snoozable one. */
export function parseSnoozeRef(
  ref: string,
): { table: (typeof SNOOZABLE_TABLES)[number]; id: string } | null {
  const at = ref.indexOf(':');
  if (at < 1) return null;
  const table = ref.slice(0, at);
  const id = ref.slice(at + 1);
  if (!(SNOOZABLE_TABLES as readonly string[]).includes(table)) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  return { table: table as (typeof SNOOZABLE_TABLES)[number], id };
}

/** The later of two change stamps; either may be missing. */
export function laterStamp(a: string | null | undefined, b: string | null | undefined): string {
  if (!a) return b ?? '';
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

/**
 * What an inbox knows about its snoozes, keyed by ref: the refs to leave out
 * of the list and its count, the refs to mark as back from snooze, and the
 * snoozes still running for the list at the foot.
 */
export type SnoozeState = {
  hidden: ReadonlySet<string>;
  back: ReadonlySet<string>;
  active: readonly { ref: string; snoozedUntil: string }[];
};

export const NO_SNOOZES: SnoozeState = { hidden: new Set(), back: new Set(), active: [] };

/** Sorts snoozes into hidden, back and active, given each row's stamp now. */
export function snoozeStateFrom(
  snoozes: readonly InboxSnooze[],
  stamps: ReadonlyMap<string, string>,
  now: Date = new Date(),
): SnoozeState {
  const hidden = new Set<string>();
  const back = new Set<string>();
  const active: { ref: string; snoozedUntil: string }[] = [];
  for (const snooze of snoozes) {
    const stamp = stamps.get(snooze.ref);
    // A row that is gone has nothing to hide.
    if (stamp === undefined) continue;
    if (isSnoozed(snooze, stamp, now)) {
      hidden.add(snooze.ref);
      active.push({ ref: snooze.ref, snoozedUntil: snooze.snoozed_until });
    } else if (isBackFromSnooze(snooze, stamp, now)) {
      back.add(snooze.ref);
    }
  }
  active.sort((a, b) => a.snoozedUntil.localeCompare(b.snoozedUntil));
  return { hidden, back, active };
}
