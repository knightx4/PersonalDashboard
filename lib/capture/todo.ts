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

import type { RelativeDay } from '@/lib/todo/tasks/model';

export function todoCaptureForm(title: string, day: RelativeDay | ''): FormData {
  const form = new FormData();
  form.set('title', title);
  // Only when there is one. An empty field and an absent one are the same
  // thing to `taskInput`, and the absent one says what is meant.
  if (day) form.set('dueOn', day);
  return form;
}
