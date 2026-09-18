/**
 * What capture hands the todo module.
 *
 * The panel writes no tasks: it fills in the form that `addTask` in
 * app/todo/actions.ts reads, which is the same action the add form on /todo
 * submits, so validation, the timezone and the date/instant split are the
 * ones the workspace already has.
 *
 * It is a function here rather than markup in the panel because the day goes
 * over as a word -- the shell is not handed the account's today, so "today"
 * is resolved on the other side by `resolveRelativeDay` -- and the two halves
 * of that agreeing is worth asserting without a browser.
 */

import { RELATIVE_DAYS, type RelativeDay } from '@/lib/todo/tasks/model';

/**
 * When the panel is holding: one of the words, a real day, or nothing.
 *
 * Two shapes rather than one because they are answered in two zones. A chip
 * sends the word, because the shell has not been handed the account's today
 * and the browser's own is the wrong day for anyone whose list lives
 * elsewhere. A date picked in the field is already a date, and means that
 * date in any zone -- so it goes over as written and `resolveRelativeDay`
 * hands it straight through.
 */
export type CaptureDay = RelativeDay | '' | (string & {});

/** A real calendar day, YYYY-MM-DD. What the date field puts in the state. */
export function isCalendarDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isRelativeDay(value: string): value is RelativeDay {
  return (RELATIVE_DAYS as readonly string[]).includes(value);
}

export function todoCaptureForm(title: string, day: CaptureDay): FormData {
  const form = new FormData();
  form.set('title', title);
  // Only when there is one, and only when it is one of the two things the
  // other side knows how to read. An empty field and an absent one are the
  // same thing to `taskInput`, and the absent one says what is meant; half a
  // date typed into the field is neither, and sending it would turn a
  // half-finished thought into "That is not a date."
  if (isRelativeDay(day) || isCalendarDay(day)) form.set('dueOn', day);
  return form;
}
