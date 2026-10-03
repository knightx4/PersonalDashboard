import type { DashChange, DashChangeStatus } from '@/lib/talk/changes';
import { watchPlan } from '@/lib/watch/start';

/**
 * How a change Dash proposed reads on a card (plan #1190) and in the Ask
 * page's list of changes (#1191). No server imports, so the client cards can
 * use it; lib/ask/changes.ts, which writes the changes, re-exports the link.
 */

/** Where each kind's row is shown, for the card and the list to link to. */
export function changeHref(change: DashChange): string {
  switch (change.kind) {
    case 'add_todo':
      return change.writtenRef ? `/todo/all?status=all&focus=${change.writtenRef}` : '/todo';
    case 'add_goal_step':
      return change.writtenRef
        ? `/goals/${change.input.parentId}#step-${change.writtenRef}`
        : `/goals/${change.input.parentId}`;
    case 'mark_returned':
      return `/shopping/inventory/${change.input.id}`;
    case 'start_watch':
      return change.writtenRef ? `/home#watch-${change.writtenRef}` : '/home#watching';
  }
}

/**
 * "2026-10-02" as "Friday 2 October", with the year only when it is not
 * `today`'s. Read as a calendar day, so no timezone moves it.
 */
export function dueDay(day: string, today?: string): string {
  const [year, month, date] = day.split('-').map(Number);
  if (!year || !month || !date) return day;
  const at = new Date(Date.UTC(year, month - 1, date));
  const sameYear = !today || today.slice(0, 4) === day.slice(0, 4);
  // Formatted in two halves: en-GB puts a comma after the weekday once the
  // year is in, and the card reads better without one.
  const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' }).format(at);
  const dayMonth = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  }).format(at);
  return `${weekday} ${dayMonth}`;
}

/**
 * A change as a sentence in three parts, so the card can link the middle one
 * once the row exists: what is done, the thing it is done to, and the rest.
 * `done` says it in the past tense, for a change that was written.
 */
export type ChangeWords = { verb: string; what: string; rest: string };

export function changeWords(change: DashChange, done: boolean, today?: string): ChangeWords {
  switch (change.kind) {
    case 'add_todo':
      return {
        verb: done ? 'Added the todo' : 'Add the todo',
        what: change.input.title,
        rest: change.input.dueOn ? `, due ${dueDay(change.input.dueOn, today)}` : '',
      };
    case 'add_goal_step':
      return {
        verb: done ? 'Added the step' : 'Add the step',
        what: change.input.title,
        rest: ` under ${change.input.goalTitle}`,
      };
    case 'mark_returned':
      return {
        verb: done ? 'Marked' : 'Mark',
        what: change.input.itemTitle,
        rest: done ? ' returned, with a full refund' : ' returned, with a full refund at what it cost',
      };
    case 'start_watch':
      return {
        verb: done ? 'Started watching' : 'Watch',
        what: change.input.title,
        rest: watchPlan(change.input, dueDay(change.input.endsOn, today)),
      };
  }
}

/** The whole sentence, for a label or a test. */
export function changeSentence(change: DashChange, done: boolean, today?: string): string {
  const words = changeWords(change, done, today);
  return `${words.verb} ${words.what}${words.rest}`;
}

/** What became of a change, in a word or two beside it. */
export const CHANGE_STATUS_LABEL: Record<DashChangeStatus, string> = {
  proposed: 'Waiting for you',
  done: 'Done',
  declined: 'Declined',
  undone: 'Undone',
};

/** Where a written change's row is, as the link's words. */
export function changeWhere(change: DashChange): string {
  switch (change.kind) {
    case 'add_todo':
      return 'Open in Todo';
    case 'add_goal_step':
      return 'Open the goal';
    case 'mark_returned':
      return 'Open the item';
    case 'start_watch':
      return 'Open on the home page';
  }
}
