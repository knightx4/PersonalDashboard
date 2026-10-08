import type { DashChange, DashChangeStatus } from '@/lib/talk/changes';
import { watchPlan } from '@/lib/watch/start';
import { stepHref } from '@/lib/goals/all-goals';
import { statusLabel } from '@/lib/jobs/status-label';

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
        ? stepHref(change.input.parentId, change.writtenRef)
        : `/goals/${change.input.parentId}`;
    case 'mark_returned':
      return `/shopping/inventory/${change.input.id}`;
    case 'start_watch':
      return change.writtenRef ? `/home#watch-${change.writtenRef}` : '/home#watching';
    case 'add_goal':
      return change.writtenRef ? `/goals/${change.writtenRef}` : '/goals';
    case 'change_todo':
    case 'close_todo':
      return `/todo/all?status=all&focus=${change.input.id}`;
    case 'close_goal_step':
      return stepHref(change.input.goalId, change.input.id);
    case 'add_role_note':
      return `/jobs/roles/${change.input.roleId}`;
    case 'add_idea':
      return '/dev/ideas';
    case 'add_job_lead':
      return `/jobs/roles/${change.input.roleId}`;
    case 'change_items':
      return change.input.change === 'for_sale' ? '/shopping/sell' : '/shopping/inventory';
    case 'move_roles':
      return '/jobs/pipeline';
  }
}

/** "Kindle, Lamp and Mug", or "Kindle, Lamp, Mug and 9 more". */
export function namedItems(titles: readonly string[], count: number): string {
  const shown = titles.slice(0, 3);
  const more = count - shown.length;
  if (more > 0) return `${shown.join(', ')} and ${more} more`;
  if (shown.length <= 1) return shown.join('');
  return `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
}

/** Many roles moved or archived at once, as the card's three parts. */
function roleWords(input: Extract<DashChange, { kind: 'move_roles' }>['input'], done: boolean): ChangeWords {
  const { count } = input;
  const roles = `${count} ${count === 1 ? 'role' : 'roles'}`;
  const list = input.titles.length > 0 ? `: ${namedItems(input.titles, count)}` : '';
  if (input.stage === 'archive') return { verb: done ? 'Archived' : 'Archive', what: roles, rest: list };
  return { verb: done ? 'Moved' : 'Move', what: roles, rest: ` to ${statusLabel(input.status)}${list}` };
}

/** Many items changed at once, as the card's three parts. */
function itemWords(input: Extract<DashChange, { kind: 'change_items' }>['input'], done: boolean): ChangeWords {
  const { count } = input;
  const items = `${count} ${count === 1 ? 'item' : 'items'}`;
  const list = input.titles.length > 0 ? `: ${namedItems(input.titles, count)}` : '';
  switch (input.change) {
    case 'for_sale':
      return { verb: done ? 'Marked' : 'Mark', what: items, rest: ` for sale${list}` };
    case 'not_for_sale':
      return { verb: done ? 'Took' : 'Take', what: items, rest: ` off the sell page${list}` };
    case 'to_return':
      return { verb: done ? 'Marked' : 'Mark', what: items, rest: ` to return${list}` };
    case 'not_returning':
      return { verb: done ? 'Took' : 'Take', what: items, rest: ` off the to-return list${list}` };
    case 'group':
      return { verb: done ? 'Grouped' : 'Group', what: `${count} copies`, rest: ` as one item${list}` };
  }
}

/** A note as the card quotes it: its first line, cut at a word. */
function quoted(body: string, max = 80): string {
  const line = body.split('\n')[0].trim();
  if (line.length <= max) return line;
  const cut = line.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
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
    case 'add_goal':
      return {
        verb: done ? 'Added the goal' : 'Add the goal',
        what: change.input.title,
        rest: ` under ${change.input.areaName}${change.input.areaMade ? ', a new area' : ''}${change.input.dueOn ? `, due ${dueDay(change.input.dueOn, today)}` : ''}`,
      };
    case 'change_todo': {
      const { renamedFrom, moved, dueOn, dueTime } = change.input;
      const day = dueOn ? `${dueDay(dueOn, today)}${dueTime ? ` at ${dueTime}` : ''}` : null;
      const move = moved ? (day ? `moved to ${day}` : 'with no due date now') : '';
      if (renamedFrom) {
        return {
          verb: done ? 'Renamed the todo' : 'Rename the todo',
          what: change.input.title,
          rest: ` (it was ${renamedFrom})${move ? `, ${move}` : ''}`,
        };
      }
      if (!day) {
        return { verb: done ? 'Took the due date off' : 'Take the due date off', what: change.input.title, rest: '' };
      }
      return { verb: done ? 'Moved the todo' : 'Move the todo', what: change.input.title, rest: ` to ${day}` };
    }
    case 'close_todo': {
      const items = change.input.items;
      return {
        verb: done ? 'Ticked off' : 'Tick off',
        what: change.input.title,
        rest: items > 0 ? `, with the ${items === 1 ? 'item' : `${items} items`} on its list` : '',
      };
    }
    case 'close_goal_step':
      return {
        verb: done ? 'Closed the step' : 'Close the step',
        what: change.input.title,
        rest: ` under ${change.input.goalTitle}`,
      };
    case 'add_role_note':
      return {
        verb: done ? 'Added a note to' : 'Add a note to',
        what: change.input.roleTitle,
        rest: `: ${quoted(change.input.body)}`,
      };
    case 'add_idea':
      return {
        verb: done ? 'Filed the idea' : 'File the idea',
        what: quoted(change.input.body),
        rest: ' on the ideas page',
      };
    case 'add_job_lead':
      return {
        verb: done ? 'Saved the lead' : 'Save the lead',
        what: change.input.roleTitle,
        rest: ` at ${change.input.companyName}`,
      };
    case 'change_items':
      return itemWords(change.input, done);
    case 'move_roles':
      return roleWords(change.input, done);
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
    case 'add_goal':
      return 'Open the goal';
    case 'change_todo':
    case 'close_todo':
      return 'Open in Todo';
    case 'close_goal_step':
      return 'Open the goal';
    case 'add_role_note':
      return 'Open the role';
    case 'add_idea':
      return 'Open the ideas';
    case 'add_job_lead':
      return 'Open the role';
    case 'change_items':
      return change.input.change === 'for_sale' ? 'Open the sell page' : 'Open the inventory';
    case 'move_roles':
      return 'Open the pipeline';
  }
}
