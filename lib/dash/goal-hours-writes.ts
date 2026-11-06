import { noButton } from './runs';
import { isUuid } from '@/lib/ask/db';
import { toRef } from '@/lib/core/refs';
import { stepHref } from '@/lib/goals/all-goals';
import { formatWeekday } from '@/lib/goals/dates';
import { PROGRESS_TEXT_MAX } from '@/lib/goals/progress';
import { addProgressEntry } from '@/lib/goals/progress-store';
import { GoalsRefused } from './goals-refused';
import type { GoalsMade, GoalsWrite, GoalsWriteEnv } from './goals-writes';

/**
 * log_hours (plan #2906.1): hours spent on a goal or a step on one day,
 * asked for in words ("log 2 hours on the thesis for yesterday"). It writes
 * one goals.progress_entries row in hours, the unit an hours metric adds up
 * (lib/goals/metrics.ts, hoursOf), through the same store the capture box
 * files progress with.
 *
 * The record names that entry as its subject with op insert, so the one undo
 * rule (lib/core/dash-actions.ts) deletes that entry by its id and nothing
 * else on the goal.
 */

type Args = Record<string, unknown>;
type Row = Record<string, unknown>;

const ITEM = 'goals.items';
const ENTRY = 'goals.progress_entries';
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The most one entry may log: a day has no more. */
export const HOURS_MAX = 24;

function text(args: Args, key: string): string {
  const value = args[key];
  return typeof value === 'string' ? value.trim() : '';
}

function named(title: unknown, fallback: string): string {
  const line = typeof title === 'string' ? title.split('\n')[0].trim() : '';
  if (!line) return fallback;
  return line.length > 120 ? `${line.slice(0, 119).trimEnd()}…` : line;
}

async function ownItem(env: GoalsWriteEnv, id: string): Promise<Row | null> {
  const { data, error } = await env.goals.from('items').select('*').eq('id', id).eq('user_id', env.userId).maybeSingle();
  if (error) throw new Error(`Reading goals.items failed: ${error.message}`);
  return (data as Row | null) ?? null;
}

/** The goal at the top of a step's branch, for the link and the sentence. */
async function goalAbove(env: GoalsWriteEnv, step: Row): Promise<Row> {
  let at = step.parent_id as string | null;
  for (let depth = 0; at && depth < 20; depth++) {
    const up = await ownItem(env, at);
    if (!up) break;
    if (up.level === 'goal') return up;
    at = up.parent_id as string | null;
  }
  throw new GoalsRefused('Dash could not find the goal that step sits under.');
}

/** The day asked for, today when none was: a real calendar day, not after today. */
export function loggedDay(value: string, today: string): string {
  if (!value) return today;
  if (!DAY.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new GoalsRefused('day must be a date like 2026-11-03.');
  }
  if (value > today) throw new GoalsRefused(`${value} has not happened yet: hours are logged on today or a day before it.`);
  return value;
}

function hoursFrom(args: Args): number {
  const raw = args.hours;
  const hours = typeof raw === 'string' ? Number(raw) : raw;
  if (typeof hours !== 'number' || !Number.isFinite(hours) || hours <= 0) {
    throw new GoalsRefused('hours must be a number more than 0, such as 1.5.');
  }
  if (hours > HOURS_MAX) throw new GoalsRefused(`That is more than ${HOURS_MAX} hours, which one day does not hold.`);
  // Quarter hours are as fine as anyone logs; 1.333 is kept as 1.33.
  return Math.round(hours * 100) / 100;
}

/** "1 hour", "2.5 hours". */
export function hoursWords(hours: number): string {
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

async function logHours(env: GoalsWriteEnv, args: Args): Promise<GoalsMade> {
  const id = text(args, 'item_ref');
  if (!id) throw new GoalsRefused('item_ref is missing: give the goals.items ref a lookup returned for the goal or step.');
  if (!isUuid(id)) throw new GoalsRefused("item_ref must be a goal's or step's goals.items ref, as a lookup returned it.");
  const hours = hoursFrom(args);
  const today = env.today ?? new Date().toISOString().slice(0, 10);
  const day = loggedDay(text(args, 'day'), today);
  const note = text(args, 'text');
  if (note.length > PROGRESS_TEXT_MAX) throw new GoalsRefused(`Keep the text under ${PROGRESS_TEXT_MAX} characters.`);

  const item = await ownItem(env, id);
  if (!item) throw new GoalsRefused('There is no goal or step of theirs with that item_ref. Look it up first.');
  if (item.archived_at != null) throw new GoalsRefused('That goal or step is archived. Restore it first.');
  const isStep = item.level === 'step';
  const goal = isStep ? await goalAbove(env, item) : item;
  const title = named(item.title, isStep ? 'the step' : 'the goal');
  const goalTitle = named(goal.title, 'the goal');

  // On the person's session, as every Goals write here is: they asked for it.
  const entryId = await addProgressEntry(await env.write({}), env.userId, {
    itemId: id,
    text: note || hoursWords(hours),
    happenedOn: day,
    quantity: hours,
    unit: 'hours',
  });
  if (!entryId) throw new GoalsRefused('That goal or step has just been archived.');

  const goalId = goal.id as string;
  const href = isStep ? stepHref(goalId, id) : `/goals/${goalId}`;
  const ref = toRef(ENTRY, entryId);
  const { data: after, error } = await env.goals.from('progress_entries').select('*').eq('id', entryId).maybeSingle();
  if (error) throw new Error(`Reading goals.progress_entries failed: ${error.message}`);
  const when = formatWeekday(day);
  return {
    kind: 'log_hours',
    input: {
      verb: `Logged ${hoursWords(hours)} on`,
      what: title,
      rest: `${isStep ? ` under ${goalTitle}` : ''}, on ${when}`,
      href,
      where: isStep ? 'Open the step' : 'Open the goal',
      paths: ['/goals', '/goals/all', '/home', `/goals/${goalId}`, ...(isStep ? [href] : [])],
    },
    subjectRef: ref,
    op: 'insert',
    before: null,
    after: (after as Row | null) ?? null,
    undo: null,
    summary: `Dash logged ${hoursWords(hours)} on ${isStep ? `the step "${title}" under "${goalTitle}"` : `the goal "${title}"`} for ${day}.`,
    row: { table: ITEM, ref: id, title, href },
  };
}

export const LOG_HOURS: GoalsWrite = {
  name: 'log_hours',
  runs: noButton('No Goals page logs progress against a step by hand; the capture box is the only place progress is filed.'),
  description:
    "Log hours the person spent on one of their goals or a step under one, on a day, when they ask you to (\"log 2 hours on the thesis\", \"I did 90 minutes of piano yesterday\"). Look the goal or step up first with search (kinds [\"goal\"] or [\"step\"]) or goal_status, and name it by the goals.items ref it returned; put it on the step when they named one, else on the goal. hours is the time in hours (90 minutes is 1.5), at most 24. day is YYYY-MM-DD, worked out from today's date when they said yesterday or a weekday, and left out for today; a day after today is refused. text is what they did, in a short phrase in their words, only when they said more than the hours. One call is one day: hours on several days are one call each.",
  input_schema: {
    type: 'object',
    properties: {
      item_ref: { type: 'string', description: 'The goals.items ref a lookup returned for the goal or step.' },
      hours: { type: 'number', description: 'The time spent, in hours: 2, 1.5, 0.25.' },
      day: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'The day it was spent, YYYY-MM-DD; left out for today.' },
      text: { type: 'string', description: 'What they did in that time, in a short phrase, only when they said.' },
    },
    required: ['item_ref', 'hours'],
    additionalProperties: false,
  },
  run: logHours,
};
