import { addDays } from '@/lib/todo/tasks/model';
import { sortTags, tagList } from '@/lib/todo/tasks/tags';

/**
 * The tags Dash puts on a todo it adds or edits (plan #2340.4).
 *
 * Every todo Dash tags gets one of two tags for when it is wanted: "now" for
 * one due today or before, "eventually" for one with no date or one more than
 * two weeks off. A date in between gets neither, since it is neither. The
 * model may send other tags beside it (one the person already uses that
 * clearly fits), and may send "now" itself for a todo they said they need
 * today without naming a date; a time tag it sent is never overridden.
 *
 * Kept apart from the tools so the rule is tested on its own, and so a todo
 * Dash adds is tagged even when the model sends no tags at all.
 */

export const NOW_TAG = 'now';
export const EVENTUALLY_TAG = 'eventually';

/** A due date further off than this many days counts as eventually. */
export const DISTANT_DAYS = 14;

/** The time tag a todo due on `dueOn` takes, seen from `today`; null for a date in between. */
export function timeTag(dueOn: string | null, today: string): string | null {
  if (!dueOn) return EVENTUALLY_TAG;
  if (dueOn <= today) return NOW_TAG;
  if (dueOn > addDays(today, DISTANT_DAYS)) return EVENTUALLY_TAG;
  return null;
}

/**
 * The tags Dash writes: the ones the model sent, normalised, with the time
 * tag added unless the model already sent "now" or "eventually". Refused
 * with the reason when a tag is blank, too long or given twice.
 */
export function dashTags(
  given: unknown,
  dueOn: string | null,
  today: string,
): { ok: true; tags: string[] } | { ok: false; error: string } {
  const parsed = tagList.safeParse(given ?? []);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const tags = parsed.data;
  if (!tags.includes(NOW_TAG) && !tags.includes(EVENTUALLY_TAG)) {
    const time = timeTag(dueOn, today);
    if (time) tags.push(time);
  }
  return { ok: true, tags: sortTags(tags) };
}
