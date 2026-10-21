import { sameAs, type DashWriteRuns } from './runs';
import type Anthropic from '@anthropic-ai/sdk';
import { isUuid, type AskRow, type SchemaClient } from '@/lib/ask/db';
import type { GoalsChangeInput, GoalsChangeKind } from '@/lib/ask/goals-changes';
import { parseRef, toRef } from '@/lib/core/refs';
import type { GoalsActor, GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { DUE_PRECISIONS } from '@/lib/goals/due-precision';
import {
  archiveArea,
  insertArea,
  moveGoal,
  renameArea,
  insertGoal,
  setAreaNote,
  setGoalArchived,
  settleGoal,
  unarchiveArea,
  updateGoal,
} from '@/lib/goals/store';
import { stepHref } from '@/lib/goals/all-goals';
import { MAX_QUESTIONS, MAX_QUESTION_LENGTH, questionKey, readQuestions, type StepQuestion } from '@/lib/goals/answers';
import { checkRecord, type CollectionField, type RecordValues } from '@/lib/goals/collections';
import { archiveRecord, restoreRecord } from '@/lib/goals/collections-store';
import { KIND_NAME_MAX, RECOGNISE_MAX, SKIPPED_LABEL_MAX, SKIPPED_MAX, parseSenders } from '@/lib/goals/document-kinds';
import { editKind, forgetKind } from '@/lib/goals/document-kinds-store';
import { DEFAULT_LIST_NAMES, LISTED_KINDS, isListedKind, listNameOf, parseListName, type ListedKind } from '@/lib/goals/links';
import { linkTarget, unlinkTarget } from '@/lib/goals/links-store';
import { recordAttended } from '@/lib/goals/suggestions-store';
import { snoozeRow, unsnoozeRow } from '@/lib/core/inbox-snooze-store';
import { SNOOZE_CHOICES, dayStartIn, snoozeDay } from '@/lib/core/snooze-days';
import { numberFromChoices, parseMeasureFields, type NumberSource } from '@/lib/goals/readings';
import { setGoalMeasure, setNumberFrom } from '@/lib/goals/readings-store';
import { SET_ASIDE_CHOICES, setAsideFields, setAsideOn, type SetAsideChoice } from '@/lib/goals/set-aside';
import { RHYTHM_PERIODS, STEP_KINDS, parseStepFields, type StepFields } from '@/lib/goals/steps';
import {
  blockStep,
  deleteDependency,
  insertDependency,
  linkStep,
  setStepArchived,
  setStepQuestions,
  setStepStatus,
  unlinkStep,
  updateStep,
} from '@/lib/goals/steps-store';
import { parseAreaName, parseAreaNote, parseGoalFields, reorder } from '@/lib/goals/tree';
import type { DashWriteContext, DashWriteResult, DashWriteTool } from './registry';
import { CHANGE_GOAL_LIST } from './goal-lists-writes';
import { GoalsRefused } from './goals-refused';

/**
 * The Goals changes an agent makes when asked, beyond the four Ask already
 * had (plan #1894.7.1, feature #1894):
 *
 *   change_goal_area  an area added, renamed, given a note, moved up or down,
 *                     archived or restored.
 *   change_goal       a goal reworded, given a due date or moved to another
 *                     area, moved up or down, archived or restored, closed,
 *                     parked or reopened.
 *   change_goal_step  a step reworded or otherwise edited, dropped, reopened
 *                     or blocked, moved up or down, archived or restored,
 *                     counted towards another goal or no longer, and made to
 *                     wait on another step or no longer (plan #1894.7.2).
 *   change_goal_number  a goal's unit and target set or cleared, or its
 *                     number worked out from a collection serving it.
 *   change_goal_link  a goal linked to a Learn goal or the job search, or
 *                     unlinked; and a reading, event, saved product or
 *                     contact listed on a goal or taken off (plan #2330.1).
 *   change_goal_form  an information step's questions set, a row archived or
 *                     brought back, and a kind of document edited or
 *                     forgotten (plan #1894.7.3).
 *   change_goals_inbox  a goal or step snoozed on the Goals Inbox or brought
 *                     back, and whether they went to an event recorded
 *                     (plan #1894.7.4). change_goal_step's set_aside and
 *                     bring_back are the Goals home's Not now.
 *
 * They are the Goals home's own writes (app/goals/actions.ts), made with the
 * same store functions. Each names one row as its subject, so the one undo
 * rule in lib/core/dash-actions.ts puts it back from the values kept (#1894.4:
 * an agent's writes go straight in, each listed on Home with an Undo). A move
 * re-deals the positions of every row beside it, and archiving an area
 * archives its goals with it, so neither can be put back from one row: those
 * keep a sentence saying how to reverse them in `undo.none`, and Home shows
 * it in place of the button.
 *
 * Every write goes on a goals client recording as the person (`{}`), as
 * set_goal_done_when does: they asked for it in their own words, and
 * goals.items_claude_guard refuses a status or wording change made as Dash's,
 * which is right for a run deciding on its own.
 *
 * Both Ask and the connector run them, as Todo's (lib/dash/todo-writes.ts):
 * Ask on the person's own clients, the connector on service-role ones for the
 * verified person. The store functions filter by id alone and rely on row
 * level security, which the service role passes, so every area and goal is
 * read here by its id and the person's user id before one is used.
 */

export type GoalsWriteEnv = {
  userId: string;
  /** The goals schema, for reads. */
  goals: SchemaClient;
  /** A goals client recording its writes in goals.history as `actor`; `{}` is the person. */
  write: (history: { actor?: GoalsActor }) => Promise<GoalsSupabaseClient>;
  /** The core schema, for the Goals Inbox's snoozes (change_goals_inbox). Absent, a snooze is refused. */
  core?: SchemaClient;
  /** YYYY-MM-DD in the person's timezone; today in UTC when absent. */
  today?: string;
  /** The person's IANA timezone, for when a snooze ends; UTC when absent. */
  timezone?: string;
};

/** A Goals change as made, before a surface keeps it. */
export type GoalsMade = {
  kind: GoalsChangeKind;
  input: GoalsChangeInput;
  subjectRef: string;
  op: 'insert' | 'update' | 'delete';
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  /** `{ none }` when the change cannot be put back from its one row. */
  undo: Record<string, unknown> | null;
  summary: string;
  row: AskRow;
};

export type GoalsWrite = {
  name: GoalsChangeKind;
  /** The buttons it does the same as, or why none does (./runs.ts). */
  runs: DashWriteRuns;
  /** Without the line each surface adds on where the change shows. */
  description: string;
  input_schema: Anthropic.Tool['input_schema'];
  run: (env: GoalsWriteEnv, args: Args) => Promise<GoalsMade>;
};

/** A refusal the model reads and says in words. */
export { GoalsRefused };

type Args = Record<string, unknown>;
type Row = Record<string, unknown>;

function text(args: Args, key: string): string {
  const value = args[key];
  return typeof value === 'string' ? value.trim() : '';
}

/** A name cut to a line for a sentence. */
function named(title: unknown, fallback: string): string {
  const line = typeof title === 'string' ? title.split('\n')[0].trim() : '';
  if (!line) return fallback;
  return line.length > 120 ? `${line.slice(0, 119).trimEnd()}…` : line;
}

async function ownRow(client: SchemaClient, table: string, id: string, userId: string): Promise<Row | null> {
  const { data, error } = await client.from(table).select('*').eq('id', id).eq('user_id', userId).maybeSingle();
  if (error) throw new Error(`Reading goals.${table} failed: ${error.message}`);
  return (data as Row | null) ?? null;
}

const AREA = 'goals.areas';
const ITEM = 'goals.items';
const areaHref = (id: string) => `/goals/area/${id}`;
const goalHref = (id: string) => `/goals/${id}`;
const GOAL_PATHS = ['/goals', '/goals/all', '/home'];

const MOVE_AREA_UNDO =
  'Moving an area reorders the areas beside it, so it is moved back on Goals, or by asking Dash to move it the other way.';
const MOVE_GOAL_UNDO =
  'Moving a goal reorders the goals beside it, so it is moved back on Goals, or by asking Dash to move it the other way.';
const ARCHIVE_AREA_UNDO =
  'Archiving an area archives its goals with it, so it is brought back by asking Dash to restore the area.';
const RESTORE_AREA_UNDO =
  'Restoring an area brings back the goals archived with it, so it is archived again on Goals, or by asking Dash.';

// ---------------------------------------------------------------------------
// Finding the person's area
// ---------------------------------------------------------------------------

/**
 * One of the person's areas, by its goals.areas ref or by its name as they
 * have it. `archived` looks among the archived ones instead, for a restore.
 */
async function findArea(env: GoalsWriteEnv, wanted: string, { archived = false } = {}): Promise<Row> {
  if (!wanted) throw new GoalsRefused('area is missing: name the area, or give the goals.areas ref a lookup returned.');
  if (isUuid(wanted)) {
    const row = await ownRow(env.goals, 'areas', wanted, env.userId);
    if (row && (row.archived_at == null) !== archived) return row;
  }
  let query = env.goals.from('areas').select('*').eq('user_id', env.userId);
  query = archived ? query.not('archived_at', 'is', null) : query.is('archived_at', null);
  const { data, error } = await query.order('position', { ascending: true });
  if (error) throw new Error(`Reading the areas failed: ${error.message}`);
  const areas = (data ?? []) as Row[];
  const key = wanted.toLowerCase();
  const found = areas.find((a) => String(a.name).trim().toLowerCase() === key);
  if (found) return found;
  if (archived) throw new GoalsRefused(`They have no archived area called "${wanted}".`);
  const names = areas.map((a) => `"${a.name}"`).join(', ');
  throw new GoalsRefused(
    areas.length > 0 ? `They have no area called "${wanted}". Their areas are ${names}.` : 'They have no areas yet.',
  );
}

/** One place up or down among the person's live areas, positions re-dealt in tens as the page does. */
async function moveOwnArea(env: GoalsWriteEnv, id: string, direction: 'up' | 'down'): Promise<boolean> {
  const { data, error } = await env.goals
    .from('areas')
    .select('id')
    .eq('user_id', env.userId)
    .is('archived_at', null)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw new Error(`Reading the areas failed: ${error.message}`);
  const order = reorder(
    ((data ?? []) as Row[]).map((row) => row.id as string),
    id,
    direction,
  );
  if (!order) return false;
  const client = await env.write({});
  const results = await Promise.all(
    order.map((areaId, i) =>
      client
        .from('areas')
        .update({ position: (i + 1) * 10 })
        .eq('id', areaId)
        .eq('user_id', env.userId),
    ),
  );
  const failed = results.find((result) => result.error);
  if (failed?.error) throw new Error(failed.error.message);
  return true;
}

// ---------------------------------------------------------------------------
// change_goal_area
// ---------------------------------------------------------------------------

const AREA_CHANGES = ['add', 'rename', 'note', 'move_up', 'move_down', 'archive', 'restore'] as const;
type AreaChange = (typeof AREA_CHANGES)[number];

function areaChange(args: Args): AreaChange {
  const change = text(args, 'change');
  if (!(AREA_CHANGES as readonly string[]).includes(change)) {
    throw new GoalsRefused(`change must be one of ${AREA_CHANGES.join(', ')}.`);
  }
  return change as AreaChange;
}

async function changeGoalArea(env: GoalsWriteEnv, args: Args): Promise<GoalsMade> {
  const change = areaChange(args);

  if (change === 'add') {
    const name = parseAreaName(text(args, 'name') || text(args, 'area'));
    if (!name.ok) throw new GoalsRefused(name.error);
    const { data, error } = await env.goals
      .from('areas')
      .select('id, name')
      .eq('user_id', env.userId)
      .is('archived_at', null);
    if (error) throw new Error(`Reading the areas failed: ${error.message}`);
    const key = name.value.toLowerCase();
    if (((data ?? []) as Row[]).some((a) => String(a.name).trim().toLowerCase() === key)) {
      throw new GoalsRefused(`They have an area called "${name.value}" already.`);
    }
    const id = await insertArea(await env.write({}), env.userId, name.value);
    const after = await ownRow(env.goals, 'areas', id, env.userId);
    return {
      kind: 'change_goal_area',
      input: { verb: 'Added', what: name.value, rest: ' as an area in Goals', href: areaHref(id), where: 'Open the area', paths: GOAL_PATHS },
      subjectRef: toRef(AREA, id),
      op: 'insert',
      before: null,
      after,
      undo: null,
      summary: `Dash added the area ${name.value} to Goals.`,
      row: { table: AREA, ref: id, title: name.value, href: areaHref(id) },
    };
  }

  const before = await findArea(env, text(args, 'area'), { archived: change === 'restore' });
  const id = before.id as string;
  const title = named(before.name, 'the area');
  const client = () => env.write({});
  const changed = (verb: string, rest: string, summary: string, undo: string | null = null) =>
    reportArea(env, before, { verb, rest, summary, undo });

  switch (change) {
    case 'rename': {
      const name = parseAreaName(args.name);
      if (!name.ok) throw new GoalsRefused(name.error);
      if (name.value === before.name) throw new GoalsRefused(`That area is called "${name.value}" already.`);
      if (!(await renameArea(await client(), id, name.value))) throw new GoalsRefused('That area has just been archived.');
      return changed('Renamed', ` to ${name.value}`, `Dash renamed the area ${title} to ${name.value}.`);
    }
    case 'note': {
      const note = parseAreaNote(args.note);
      if (!note.ok) throw new GoalsRefused(note.error);
      if ((before.note ?? null) === note.value) throw new GoalsRefused('That area has that note already.');
      if (!(await setAreaNote(await client(), id, note.value))) throw new GoalsRefused('That area has just been archived.');
      return note.value
        ? changed('Wrote', ' what they want from it', `Dash wrote what they want from the area ${title}: "${named(note.value, '')}".`)
        : changed('Cleared', "'s note", `Dash cleared the note on the area ${title}.`);
    }
    case 'move_up':
    case 'move_down': {
      const direction = change === 'move_up' ? 'up' : 'down';
      if (!(await moveOwnArea(env, id, direction))) {
        throw new GoalsRefused(`That area is ${direction === 'up' ? 'first' : 'last'} already.`);
      }
      return changed('Moved', ` ${direction}`, `Dash moved the area ${title} ${direction} in Goals.`, MOVE_AREA_UNDO);
    }
    case 'archive': {
      if (!(await archiveArea(await client(), id))) throw new GoalsRefused('That area has already changed.');
      return changed('Archived', ' with its goals', `Dash archived the area ${title} and the goals in it.`, ARCHIVE_AREA_UNDO);
    }
    case 'restore': {
      if (!(await unarchiveArea(await client(), id))) throw new GoalsRefused('That area is not archived.');
      return changed('Restored', ' with the goals archived with it', `Dash restored the area ${title} and the goals archived with it.`, RESTORE_AREA_UNDO);
    }
  }
}

async function reportArea(
  env: GoalsWriteEnv,
  before: Row,
  words: { verb: string; rest: string; summary: string; undo: string | null },
): Promise<GoalsMade> {
  const id = before.id as string;
  const after = await ownRow(env.goals, 'areas', id, env.userId);
  const title = named(after?.name ?? before.name, 'the area');
  return {
    kind: 'change_goal_area',
    input: { verb: words.verb, what: named(before.name, 'the area'), rest: words.rest, href: areaHref(id), where: 'Open the area', paths: [...GOAL_PATHS, areaHref(id)] },
    subjectRef: toRef(AREA, id),
    op: 'update',
    before,
    after,
    undo: words.undo ? { none: words.undo } : null,
    summary: words.summary,
    row: { table: AREA, ref: id, title, href: areaHref(id) },
  };
}

// ---------------------------------------------------------------------------
// change_goal
// ---------------------------------------------------------------------------

const GOAL_CHANGES = ['edit', 'move_up', 'move_down', 'archive', 'restore', 'close', 'park', 'reopen'] as const;
type GoalChange = (typeof GOAL_CHANGES)[number];

function goalChange(args: Args): GoalChange {
  const change = text(args, 'change');
  if (!(GOAL_CHANGES as readonly string[]).includes(change)) {
    throw new GoalsRefused(`change must be one of ${GOAL_CHANGES.join(', ')}.`);
  }
  return change as GoalChange;
}

const STATUS_WORDS: Record<string, string> = { open: 'open', done: 'closed', parked: 'parked', proposed: 'still proposed' };

async function changeGoal(env: GoalsWriteEnv, args: Args): Promise<GoalsMade> {
  const change = goalChange(args);
  const id = text(args, 'goal_ref');
  if (!id) throw new GoalsRefused('goal_ref is missing: give the goals.items ref a lookup returned for the goal.');
  if (!isUuid(id)) throw new GoalsRefused("goal_ref must be a goal's goals.items ref, as a lookup returned it.");
  const before = await ownRow(env.goals, 'items', id, env.userId);
  if (!before) throw new GoalsRefused('There is no goal of theirs with that ref. Look it up first.');
  if (before.level !== 'goal') throw new GoalsRefused('That is a step, not a goal.');
  const archived = before.archived_at != null;
  if (archived !== (change === 'restore')) {
    throw new GoalsRefused(archived ? 'That goal is archived. Restore it first.' : 'That goal is not archived.');
  }
  const title = named(before.title, 'the goal');
  const client = () => env.write({});
  const changed = (verb: string, rest: string, summary: string, undo: string | null = null) =>
    reportGoal(env, before, { verb, rest, summary, undo });

  switch (change) {
    case 'edit':
      return editGoal(env, before, args);
    case 'move_up':
    case 'move_down': {
      const direction = change === 'move_up' ? 'up' : 'down';
      if (!(await moveGoal(await client(), id, direction))) {
        throw new GoalsRefused(`That goal is ${direction === 'up' ? 'first' : 'last'} in its area already.`);
      }
      return changed('Moved', ` ${direction} in its area`, `Dash moved the goal "${title}" ${direction} in its area.`, MOVE_GOAL_UNDO);
    }
    case 'archive':
    case 'restore': {
      if (!(await setGoalArchived(await client(), id, change === 'archive'))) throw new GoalsRefused('That goal has already changed.');
      return change === 'archive'
        ? changed('Archived', '', `Dash archived the goal "${title}".`)
        : changed('Restored', '', `Dash restored the goal "${title}".`);
    }
    case 'close':
    case 'park':
    case 'reopen': {
      const from = change === 'reopen' ? ['parked', 'done'] : ['open'];
      if (!from.includes(before.status as string)) {
        throw new GoalsRefused(`That goal is ${STATUS_WORDS[before.status as string] ?? before.status}, so it cannot be ${change === 'close' ? 'closed' : change === 'park' ? 'parked' : 'reopened'}.`);
      }
      if (!(await settleGoal(await client(), id, change))) throw new GoalsRefused('That goal has already changed.');
      return change === 'close'
        ? changed('Closed', ' as done', `Dash closed the goal "${title}" as done.`)
        : change === 'park'
          ? changed('Parked', '', `Dash parked the goal "${title}". It is taken back up from All goals.`)
          : changed('Reopened', '', `Dash reopened the goal "${title}".`);
    }
  }
}

/** A goal's wording, due date or area, any of them in one write, as the page's edit is. */
async function editGoal(env: GoalsWriteEnv, before: Row, args: Args): Promise<GoalsMade> {
  const id = before.id as string;
  const title = named(before.title, 'the goal');
  const dueSent = 'due_on' in args && args.due_on !== undefined && args.due_on !== null;
  const precision = text(args, 'due_precision');
  const parsed = parseGoalFields((key) => {
    if (key === 'title') return text(args, 'title') || undefined;
    if (key === 'due') return dueSent ? text(args, 'due_on') : undefined;
    if (key === 'duePrecision') return precision || undefined;
    return undefined;
  });
  if (!parsed.ok) throw new GoalsRefused(parsed.error);
  const fields = { ...parsed.value };

  let area: Row | null = null;
  const wantedArea = text(args, 'area');
  if (wantedArea) {
    area = await findArea(env, wantedArea);
    if (area.id !== before.area_id) fields.areaId = area.id as string;
    else area = null;
  }
  if (fields.title === before.title) delete fields.title;
  if ('dueOn' in fields && fields.dueOn === (before.due_on ?? null) && (fields.duePrecision ?? 'day') === (before.due_precision ?? 'day')) {
    delete fields.dueOn;
    delete fields.duePrecision;
  }
  if (Object.keys(fields).length === 0) {
    throw new GoalsRefused('Nothing to change: give a new title, due_on or area, different from what the goal has.');
  }
  // An errand needs its date (goals 0061): clearing an errand's date is refused by the database too.
  if (before.errand === true && fields.dueOn === null) throw new GoalsRefused('That goal is an errand, which needs a date it is due by.');

  if (!(await updateGoal(await env.write({}), id, fields))) throw new GoalsRefused('That goal or area has just changed.');

  const parts: string[] = [];
  if (fields.title) parts.push(`reworded it to "${fields.title}"`);
  if ('dueOn' in fields) parts.push(fields.dueOn ? `set it due by ${fields.dueOn}` : 'cleared its due date');
  if (area) parts.push(`moved it to ${named(area.name, 'another area')}`);
  const said = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
  return reportGoal(env, before, {
    verb: 'Changed',
    rest: fields.title ? ` to "${fields.title}"` : '',
    summary: `Dash changed the goal "${title}": ${said}.`,
    undo: null,
  });
}

async function reportGoal(
  env: GoalsWriteEnv,
  before: Row,
  words: { verb: string; rest: string; summary: string; undo: string | null; kind?: GoalsChangeKind },
): Promise<GoalsMade> {
  const id = before.id as string;
  const after = await ownRow(env.goals, 'items', id, env.userId);
  return {
    kind: words.kind ?? 'change_goal',
    input: { verb: words.verb, what: named(before.title, 'the goal'), rest: words.rest, href: goalHref(id), where: 'Open the goal', paths: [...GOAL_PATHS, goalHref(id)] },
    subjectRef: toRef(ITEM, id),
    op: 'update',
    before,
    after,
    undo: words.undo ? { none: words.undo } : null,
    summary: words.summary,
    row: { table: ITEM, ref: id, title: named(after?.title ?? before.title, 'the goal'), href: goalHref(id) },
  };
}

// ---------------------------------------------------------------------------
// change_goal_step
// ---------------------------------------------------------------------------

const STEP_CHANGES = [
  'edit',
  'drop',
  'reopen',
  'block',
  'move_up',
  'move_down',
  'archive',
  'restore',
  'count_towards',
  'stop_counting',
  'wait_on',
  'stop_waiting',
  'set_aside',
  'bring_back',
  'make_errand',
] as const;
type StepChange = (typeof STEP_CHANGES)[number];

const LINK = 'goals.item_goals';
const DEPENDENCY = 'goals.dependencies';

const MOVE_STEP_UNDO =
  'Moving a step reorders the steps beside it, so it is moved back on the goal, or by asking Dash to move it the other way.';

const STEP_STATUS_WORDS: Record<string, string> = {
  open: 'open',
  blocked: 'blocked',
  done: 'done',
  dropped: 'dropped',
  proposed: 'still a proposal',
};

function stepChange(args: Args): StepChange {
  const change = text(args, 'change');
  if (!(STEP_CHANGES as readonly string[]).includes(change)) {
    throw new GoalsRefused(`change must be one of ${STEP_CHANGES.join(', ')}.`);
  }
  return change as StepChange;
}

/** A step of the person's by its goals.items ref, refused with a sentence when it is not one. */
async function ownStep(env: GoalsWriteEnv, id: string, what: string): Promise<Row> {
  if (!id) throw new GoalsRefused(`${what} is missing: give the goals.items ref a lookup returned for the step.`);
  if (!isUuid(id)) throw new GoalsRefused(`${what} must be a step's goals.items ref, as a lookup returned it.`);
  const row = await ownRow(env.goals, 'items', id, env.userId);
  if (!row) throw new GoalsRefused(`There is no step of theirs with that ${what}. Look it up first.`);
  if (row.level !== 'step') throw new GoalsRefused(`That ${what} is a goal, not a step. A goal is changed with change_goal.`);
  return row;
}

/** The goal at the top of a step's branch, for the link and the sentence. */
async function goalAbove(env: GoalsWriteEnv, step: Row): Promise<Row> {
  let at = step.parent_id as string | null;
  for (let depth = 0; at && depth < 20; depth++) {
    const up = await ownRow(env.goals, 'items', at, env.userId);
    if (!up) break;
    if (up.level === 'goal') return up;
    at = up.parent_id as string | null;
  }
  throw new GoalsRefused('Dash could not find the goal that step sits under.');
}

/** One place up or down among the step's live siblings, every write narrowed to the person's rows. */
async function moveOwnStep(env: GoalsWriteEnv, step: Row, direction: 'up' | 'down'): Promise<boolean> {
  const { data, error } = await env.goals
    .from('items')
    .select('id, position, created_at')
    .eq('user_id', env.userId)
    .eq('parent_id', step.parent_id as string)
    .is('archived_at', null)
    .order('position', { ascending: true });
  if (error) throw new Error(`Reading the steps failed: ${error.message}`);
  const siblings = ((data ?? []) as Row[]).sort(
    (a, b) => Number(a.position) - Number(b.position) || String(a.created_at).localeCompare(String(b.created_at)),
  );
  const order = reorder(
    siblings.map((row) => row.id as string),
    step.id as string,
    direction,
  );
  if (!order) return false;
  const client = await env.write({});
  const results = await Promise.all(
    order.map((stepId, i) =>
      client
        .from('items')
        .update({ position: (i + 1) * 10 })
        .eq('id', stepId)
        .eq('user_id', env.userId),
    ),
  );
  const failed = results.find((result) => result.error);
  if (failed?.error) throw new Error(failed.error.message);
  return true;
}

/** The database's refusal as the sentence the model reads, for a write a trigger or check can turn down. */
async function guarded<T>(what: string, write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    throw new GoalsRefused(`${what}: ${error instanceof Error ? error.message : 'the database refused it'}`);
  }
}

async function changeGoalStep(env: GoalsWriteEnv, args: Args): Promise<GoalsMade> {
  const change = stepChange(args);
  const before = await ownStep(env, text(args, 'step_ref'), 'step_ref');
  const id = before.id as string;
  const archived = before.archived_at != null;
  if (archived !== (change === 'restore')) {
    throw new GoalsRefused(archived ? 'That step is archived. Restore it first.' : 'That step is not archived.');
  }
  const status = before.status as string;
  if (status === 'proposed' && change !== 'archive' && change !== 'restore') {
    throw new GoalsRefused('That step is still a proposal. They approve it on the goal first.');
  }
  const goal = await goalAbove(env, before);
  const title = named(before.title, 'the step');
  const client = () => env.write({});
  const changed = (verb: string, rest: string, summary: string, undo: string | null = null) =>
    reportStep(env, before, goal, { verb, rest, summary, undo });
  const statusWord = STEP_STATUS_WORDS[status] ?? status;

  switch (change) {
    case 'edit':
      return editStep(env, before, goal, args);
    case 'drop': {
      if (!['open', 'blocked'].includes(status)) throw new GoalsRefused(`That step is ${statusWord}, so it cannot be dropped.`);
      if (!(await guarded('It could not be dropped', async () => setStepStatus(await client(), id, 'dropped')))) {
        throw new GoalsRefused('That step has already changed.');
      }
      return changed('Dropped', '', `Dash dropped the step "${title}", under the goal "${named(goal.title, 'the goal')}".`);
    }
    case 'reopen': {
      if (status === 'open') throw new GoalsRefused('That step is open already.');
      if (!(await guarded('It could not be reopened', async () => setStepStatus(await client(), id, 'open')))) {
        throw new GoalsRefused('That step has already changed.');
      }
      return status === 'blocked'
        ? changed('Unblocked', '', `Dash unblocked the step "${title}" and set it open again.`)
        : changed('Reopened', '', `Dash reopened the step "${title}", which was ${statusWord}.`);
    }
    case 'block': {
      if (!['open', 'blocked'].includes(status)) throw new GoalsRefused(`That step is ${statusWord}, so it cannot be blocked.`);
      const ask = text(args, 'needs');
      if (!ask) throw new GoalsRefused('needs is missing: say in one sentence what the step is waiting for.');
      if (ask.length > 4000) throw new GoalsRefused('Keep what it needs under 4000 characters.');
      const kind = text(args, 'block_kind') || 'outside';
      if (kind !== 'outside' && kind !== 'steps') throw new GoalsRefused('block_kind must be outside or steps.');
      if (!(await guarded('It could not be blocked', async () => blockStep(await client(), id, ask, kind)))) {
        throw new GoalsRefused('That step has already changed.');
      }
      return changed('Blocked', `: ${named(ask, '')}`, `Dash blocked the step "${title}": it needs ${named(ask, 'something')}.`);
    }
    case 'move_up':
    case 'move_down': {
      const direction = change === 'move_up' ? 'up' : 'down';
      if (!(await moveOwnStep(env, before, direction))) {
        throw new GoalsRefused(`That step is ${direction === 'up' ? 'first' : 'last'} among its siblings already.`);
      }
      return changed('Moved', ` ${direction}`, `Dash moved the step "${title}" ${direction} under its parent.`, MOVE_STEP_UNDO);
    }
    case 'archive':
    case 'restore': {
      if (!(await setStepArchived(await client(), id, change === 'archive'))) throw new GoalsRefused('That step has already changed.');
      return change === 'archive'
        ? changed('Archived', '', `Dash archived the step "${title}". Its sub-steps are left as they are.`)
        : changed('Restored', '', `Dash restored the step "${title}".`);
    }
    case 'count_towards':
    case 'stop_counting':
      return changeStepLink(env, before, goal, change, args);
    case 'wait_on':
    case 'stop_waiting':
      return changeStepWait(env, before, goal, change, args);
    case 'set_aside': {
      if (!['open', 'blocked'].includes(status)) throw new GoalsRefused(`That step is ${statusWord}, so there is nothing to set aside.`);
      const on = asideDay(text(args, 'until'), todayOf(env));
      const { dueMoved, ...fields } = setAsideFields({ dueOn: (before.due_on as string | null) ?? null }, on);
      if (!(await guarded('It could not be set aside', async () => updateStep(await client(), id, fields)))) {
        throw new GoalsRefused('That step has just changed.');
      }
      return changed(
        'Set aside',
        ` until ${on}`,
        dueMoved
          ? `Dash set the step "${title}" aside until ${on}, and moved its due date to that day with it.`
          : `Dash set the step "${title}" aside until ${on}.`,
      );
    }
    case 'bring_back': {
      const starts = (before.starts_on as string | null) ?? null;
      if (!starts || starts <= todayOf(env)) throw new GoalsRefused('That step is not set aside: it has no start date still to come.');
      if (!(await guarded('It could not be brought back', async () => updateStep(await client(), id, { starts_on: null })))) {
        throw new GoalsRefused('That step has just changed.');
      }
      return changed('Brought back', '', `Dash brought the step "${title}" back now, clearing its start date of ${starts}.`);
    }
    case 'make_errand':
      return makeErrand(env, before, goal, args);
  }
}

const ERRAND_UNDO =
  'Two rows changed: the new errand and the archived step. Archive the errand on its page and restore the step on its goal to take it back.';

/**
 * The step as its own errand, the move a goal comment's
 * promote_step_to_errand makes (plan #2035.2), for Ask Dash (note 16a21d3a):
 * an errand titled as the step, carrying its detail, due on the day given or
 * the step's own, in the area named or the goal's. Then the step is archived.
 * No run is started.
 */
async function makeErrand(env: GoalsWriteEnv, before: Row, goal: Row, args: Args): Promise<GoalsMade> {
  const status = before.status as string;
  if (status !== 'open' && status !== 'blocked') {
    throw new GoalsRefused(`That step is ${STEP_STATUS_WORDS[status] ?? status}, so it cannot become an errand.`);
  }
  const dueOn = text(args, 'due_on') || ((before.due_on as string | null) ?? '');
  if (!dueOn) throw new GoalsRefused('An errand needs a date it is due by, and the step has none: ask them which day.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueOn)) throw new GoalsRefused('due_on must be YYYY-MM-DD.');
  const wanted = text(args, 'area');
  const area = wanted ? await findArea(env, wanted) : await ownRow(env.goals, 'areas', goal.area_id as string, env.userId);
  if (!area || area.archived_at != null) throw new GoalsRefused("The goal's area is archived: name the area the errand goes in.");

  const title = named(before.title, 'the step');
  const detail = (before.detail as string | null)?.trim() || null;
  const errandId = await guarded('The errand could not be saved', async () =>
    insertGoal(await env.write({}), env.userId, area.id as string, {
      title: before.title as string,
      errand: true,
      dueOn,
      detail,
    }),
  );
  if (!errandId) throw new GoalsRefused('That area is no longer there.');
  const archived = await setStepArchived(await env.write({}), before.id as string, true);
  const goalTitle = named(goal.title, 'the goal');
  const where = archived ? `, and archived the step from "${goalTitle}"` : `. The step could not be archived, so it is still on "${goalTitle}"`;
  const made = await reportStep(env, before, goal, {
    verb: 'Made an errand of',
    rest: ` due ${dueOn}`,
    summary: `Dash made the step "${title}" its own errand in ${named(area.name, 'its area')}, due ${dueOn}${where}.`,
    undo: ERRAND_UNDO,
  });
  const href = goalHref(errandId);
  return {
    ...made,
    input: { ...made.input, href, where: 'Open the errand', paths: [...made.input.paths, href] },
    row: { table: ITEM, ref: errandId, title, href },
  };
}

function todayOf(env: GoalsWriteEnv): string {
  return env.today ?? new Date().toISOString().slice(0, 10);
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar day after today, or null. */
function dayAfter(value: string, today: string): string | null {
  if (!DAY.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) return null;
  if (new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) return null;
  return value > today ? value : null;
}

/** The day a Not now means: one of the Goals home's choices, or a day after today. */
function asideDay(until: string, today: string): string {
  if ((SET_ASIDE_CHOICES as readonly string[]).includes(until)) return setAsideOn(until as SetAsideChoice, today);
  const day = dayAfter(until, today);
  if (!day) throw new GoalsRefused(`until must be one of ${SET_ASIDE_CHOICES.join(', ')}, or a day after today as YYYY-MM-DD.`);
  return day;
}

/** A step's wording, notes, done-when, dates or kind, any of them in one write, as the step's edit form is. */
async function editStep(env: GoalsWriteEnv, before: Row, goal: Row, args: Args): Promise<GoalsMade> {
  const id = before.id as string;
  const title = named(before.title, 'the step');
  const keys: Record<string, string> = {
    title: 'title',
    detail: 'detail',
    acceptance: 'done_when',
    dueOn: 'due_on',
    startsOn: 'starts_on',
    kind: 'kind',
    rhythmCount: 'rhythm_count',
    rhythmPeriod: 'rhythm_period',
  };
  const parsed = parseStepFields((key) => {
    const name = keys[key];
    if (!name || !(name in args) || args[name] === null || args[name] === undefined) return undefined;
    const value = args[name];
    return typeof value === 'number' ? String(value) : value;
  });
  if (!parsed.ok) throw new GoalsRefused(parsed.error);
  const fields: Record<string, unknown> = { ...parsed.value };
  for (const [column, value] of Object.entries(fields)) {
    if ((before[column] ?? null) === value) delete fields[column];
  }
  if (Object.keys(fields).length === 0) {
    throw new GoalsRefused('Nothing to change: give a new title, detail, done_when, due_on, starts_on or kind, different from what the step has.');
  }
  const starts = (fields.starts_on === undefined ? before.starts_on : fields.starts_on) as string | null;
  const due = (fields.due_on === undefined ? before.due_on : fields.due_on) as string | null;
  if (starts && due && starts > due) throw new GoalsRefused('A step has to start on or before the day it is due.');

  if (!(await guarded('It could not be changed', async () => updateStep(await env.write({}), id, fields as StepFields)))) {
    throw new GoalsRefused('That step has just changed.');
  }

  const parts: string[] = [];
  if (fields.title) parts.push(`reworded it to "${fields.title}"`);
  if ('detail' in fields) parts.push(fields.detail ? 'rewrote its detail' : 'cleared its detail');
  if ('acceptance' in fields) parts.push(fields.acceptance ? 'set when it is done' : 'cleared its done-when');
  if ('due_on' in fields) parts.push(fields.due_on ? `set it due by ${fields.due_on}` : 'cleared its due date');
  if ('starts_on' in fields) parts.push(fields.starts_on ? `set it to start on ${fields.starts_on}` : 'cleared its start date');
  if ('kind' in fields) parts.push(`made it a ${String(fields.kind) === 'claude' ? 'Dash' : String(fields.kind)} step`);
  else if ('rhythm_count' in fields || 'rhythm_period' in fields) parts.push('changed how often it comes round');
  const said = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
  return reportStep(env, before, goal, {
    verb: 'Changed',
    rest: fields.title ? ` to "${fields.title}"` : '',
    summary: `Dash changed the step "${title}": ${said}.`,
    undo: null,
  });
}

/** Counting a step towards another goal of theirs, or no longer: a goals.item_goals row. */
async function changeStepLink(
  env: GoalsWriteEnv,
  step: Row,
  goal: Row,
  change: 'count_towards' | 'stop_counting',
  args: Args,
): Promise<GoalsMade> {
  const stepId = step.id as string;
  const goalId = text(args, 'goal_ref');
  if (!goalId) throw new GoalsRefused('goal_ref is missing: give the goals.items ref of the goal it counts towards.');
  if (!isUuid(goalId)) throw new GoalsRefused("goal_ref must be a goal's goals.items ref, as a lookup returned it.");
  const other = await ownRow(env.goals, 'items', goalId, env.userId);
  if (!other || other.level !== 'goal') throw new GoalsRefused('There is no goal of theirs with that goal_ref. Look it up first.');
  const otherTitle = named(other.title, 'the goal');
  const title = named(step.title, 'the step');

  const readLink = async (): Promise<Row | null> => {
    const { data, error } = await env.goals
      .from('item_goals')
      .select('*')
      .eq('user_id', env.userId)
      .eq('item_id', stepId)
      .eq('goal_id', goalId)
      .maybeSingle();
    if (error) throw new Error(`Reading the step's goals failed: ${error.message}`);
    return (data as Row | null) ?? null;
  };
  const before = await readLink();
  const live = before != null && before.archived_at == null;

  if (change === 'count_towards') {
    if (other.archived_at != null) throw new GoalsRefused('That goal is archived. Restore it first.');
    if (goalId === goal.id) throw new GoalsRefused('That step is under that goal already.');
    if (live) throw new GoalsRefused(`That step counts towards "${otherTitle}" already.`);
    await guarded('It could not be linked', async () => linkStep(await env.write({}), env.userId, stepId, goalId));
  } else {
    if (!live) throw new GoalsRefused(`That step does not count towards "${otherTitle}".`);
    if (!(await unlinkStep(await env.write({}), before.id as string))) throw new GoalsRefused('That link has already gone.');
  }
  const after = await readLink();
  if (!after) throw new Error('The link was written but could not be read back.');
  const counting = change === 'count_towards';
  return {
    kind: 'change_goal_step',
    input: {
      verb: counting ? 'Counted' : 'Stopped counting',
      what: title,
      rest: ` towards ${otherTitle}`,
      href: stepHref(goal.id as string, stepId),
      where: 'Open the step',
      paths: [...GOAL_PATHS, goalHref(goal.id as string), goalHref(goalId)],
    },
    subjectRef: toRef(LINK, after.id as string),
    op: before ? 'update' : 'insert',
    before,
    after,
    undo: null,
    summary: counting
      ? `Dash counted the step "${title}" towards the goal "${otherTitle}" as well.`
      : `Dash stopped the step "${title}" counting towards the goal "${otherTitle}".`,
    row: { table: ITEM, ref: stepId, title, href: stepHref(goal.id as string, stepId) },
  };
}

/** Making a step wait on another of theirs, or no longer: a goals.dependencies row. */
async function changeStepWait(
  env: GoalsWriteEnv,
  step: Row,
  goal: Row,
  change: 'wait_on' | 'stop_waiting',
  args: Args,
): Promise<GoalsMade> {
  const stepId = step.id as string;
  const other = await ownStep(env, text(args, 'other_step_ref'), 'other_step_ref');
  const otherId = other.id as string;
  if (otherId === stepId) throw new GoalsRefused('A step cannot wait on itself.');
  const title = named(step.title, 'the step');
  const otherTitle = named(other.title, 'the other step');

  const readWait = async (): Promise<Row | null> => {
    const { data, error } = await env.goals
      .from('dependencies')
      .select('*')
      .eq('user_id', env.userId)
      .eq('item_id', stepId)
      .eq('depends_on_id', otherId)
      .maybeSingle();
    if (error) throw new Error(`Reading what the step waits on failed: ${error.message}`);
    return (data as Row | null) ?? null;
  };
  const href = stepHref(goal.id as string, stepId);
  const input = (verb: string, rest: string): GoalsChangeInput => ({
    verb,
    what: title,
    rest,
    href,
    where: 'Open the step',
    paths: [...GOAL_PATHS, goalHref(goal.id as string)],
  });
  const row: AskRow = { table: ITEM, ref: stepId, title, href };

  if (change === 'wait_on') {
    if (other.archived_at != null) throw new GoalsRefused('That other step is archived.');
    const refused = await insertDependency(await env.write({}), env.userId, stepId, otherId);
    if (refused === 'duplicate') throw new GoalsRefused(`That step waits on "${otherTitle}" already.`);
    if (refused === 'loop') throw new GoalsRefused('That would make the two steps wait on each other.');
    if (refused === 'not_steps') throw new GoalsRefused('Only a step can wait on another step.');
    const after = await readWait();
    if (!after) throw new Error('The wait was written but could not be read back.');
    return {
      kind: 'change_goal_step',
      input: input('Made', ` wait on ${otherTitle}`),
      subjectRef: toRef(DEPENDENCY, after.id as string),
      op: 'insert',
      before: null,
      after,
      undo: null,
      summary: `Dash made the step "${title}" wait on "${otherTitle}": it cannot start until that one is closed.`,
      row,
    };
  }

  const before = await readWait();
  if (!before) throw new GoalsRefused(`That step does not wait on "${otherTitle}".`);
  if (!(await deleteDependency(await env.write({}), before.id as string))) throw new GoalsRefused('That wait has already gone.');
  return {
    kind: 'change_goal_step',
    input: input('Stopped', ` waiting on ${otherTitle}`),
    subjectRef: toRef(DEPENDENCY, before.id as string),
    op: 'delete',
    before,
    after: null,
    undo: null,
    summary: `Dash stopped the step "${title}" waiting on "${otherTitle}".`,
    row,
  };
}

async function reportStep(
  env: GoalsWriteEnv,
  before: Row,
  goal: Row,
  words: { verb: string; rest: string; summary: string; undo: string | null },
): Promise<GoalsMade> {
  const id = before.id as string;
  const goalId = goal.id as string;
  const after = await ownRow(env.goals, 'items', id, env.userId);
  return {
    kind: 'change_goal_step',
    input: {
      verb: words.verb,
      what: named(before.title, 'the step'),
      rest: words.rest,
      href: stepHref(goalId, id),
      where: 'Open the step',
      paths: [...GOAL_PATHS, goalHref(goalId)],
    },
    subjectRef: toRef(ITEM, id),
    op: 'update',
    before,
    after,
    undo: words.undo ? { none: words.undo } : null,
    summary: words.summary,
    row: { table: ITEM, ref: id, title: named(after?.title ?? before.title, 'the step'), href: stepHref(goalId, id) },
  };
}

// ---------------------------------------------------------------------------
// change_goal_number, change_goal_link and change_goal_form (plan #1894.7.3)
// ---------------------------------------------------------------------------

/** A live goal of the person's by its goals.items ref, refused with a sentence when it is not one. */
async function ownGoal(env: GoalsWriteEnv, id: string): Promise<Row> {
  if (!id) throw new GoalsRefused('goal_ref is missing: give the goals.items ref a lookup returned for the goal.');
  if (!isUuid(id)) throw new GoalsRefused("goal_ref must be a goal's goals.items ref, as a lookup returned it.");
  const row = await ownRow(env.goals, 'items', id, env.userId);
  if (!row) throw new GoalsRefused('There is no goal of theirs with that ref. Look it up first.');
  if (row.level !== 'goal') throw new GoalsRefused('That is a step, not a goal.');
  if (row.archived_at != null) throw new GoalsRefused('That goal is archived. Restore it first.');
  return row;
}

function oneOf<T extends string>(args: Args, choices: readonly T[]): T {
  const change = text(args, 'change');
  if (!(choices as readonly string[]).includes(change)) throw new GoalsRefused(`change must be one of ${choices.join(', ')}.`);
  return change as T;
}

const NUMBER_CHANGES = ['measure', 'number_from'] as const;

/** The collections serving a goal, read through the person's own rows. */
async function goalSources(env: GoalsWriteEnv, goalId: string): Promise<NumberSource[]> {
  const served = await env.goals
    .from('collection_goals')
    .select('collection_id')
    .eq('user_id', env.userId)
    .eq('goal_id', goalId)
    .is('archived_at', null);
  if (served.error) throw new Error(`Reading the goal's collections failed: ${served.error.message}`);
  const ids = ((served.data ?? []) as Row[]).map((row) => row.collection_id as string);
  if (ids.length === 0) return [];
  const { data, error } = await env.goals
    .from('collections')
    .select('id, name, fields')
    .eq('user_id', env.userId)
    .in('id', ids)
    .is('archived_at', null);
  if (error) throw new Error(`Reading the collections failed: ${error.message}`);
  return ((data ?? []) as Row[])
    .map((row) => ({ id: row.id as string, name: String(row.name), fields: (row.fields ?? []) as CollectionField[] }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** A goal's unit and target, or where its number is worked out from (the goal page's number panel). */
async function changeGoalNumber(env: GoalsWriteEnv, args: Args): Promise<GoalsMade> {
  const change = oneOf(args, NUMBER_CHANGES);
  const before = await ownGoal(env, text(args, 'goal_ref'));
  const id = before.id as string;
  const title = named(before.title, 'the goal');
  const report = (verb: string, rest: string, summary: string) =>
    reportGoal(env, before, { verb, rest, summary, undo: null, kind: 'change_goal_number' });

  if (change === 'measure') {
    const target = args.target;
    const parsed = parseMeasureFields((key) => {
      if (key === 'unit') return text(args, 'unit');
      if (key === 'target') return typeof target === 'number' ? String(target) : text(args, 'target');
      return undefined;
    });
    if (!parsed.ok) throw new GoalsRefused(parsed.error);
    const { unit, target: wanted } = parsed.value;
    if ((before.unit ?? null) === unit && (before.target == null ? null : Number(before.target)) === wanted) {
      throw new GoalsRefused('That goal is measured that way already.');
    }
    if (!(await setGoalMeasure(await env.write({}), id, { unit, target: wanted }))) {
      throw new GoalsRefused('That goal has just changed.');
    }
    if (!unit) return report('Stopped measuring', '', `Dash stopped measuring the goal "${title}" by a number.`);
    const aim = wanted === null ? '' : `, aiming for ${wanted}`;
    return report('Measured', ` in ${unit}${aim}`, `Dash set the goal "${title}" to be measured in ${unit}${aim}.`);
  }

  const choices = numberFromChoices(await goalSources(env, id));
  const wanted = text(args, 'from');
  const choice = wanted ? choices.find((c) => c.label.toLowerCase() === wanted.toLowerCase()) : null;
  if (wanted && !choice) {
    throw new GoalsRefused(
      choices.length > 0
        ? `That goal's number can come from: ${choices.map((c) => `"${c.label}"`).join(', ')}.`
        : 'No collection serves that goal, so its number can only be typed in.',
    );
  }
  const from = choice?.from ?? null;
  const same =
    (before.number_from_collection_id ?? null) === (from?.collectionId ?? null) &&
    (before.number_from_field ?? null) === (from?.field ?? null) &&
    (before.number_from_how ?? null) === (from?.how ?? null) &&
    (before.number_from_value ?? null) === (from?.value ?? null);
  if (same) throw new GoalsRefused(choice ? `That goal's number is the ${choice.label.toLowerCase()} already.` : "That goal's number is typed in already.");
  if (!(await setNumberFrom(await env.write({}), id, from, choice?.unit ?? null))) {
    throw new GoalsRefused('That goal has just changed.');
  }
  return choice
    ? report('Worked out', ` from the ${choice.label.toLowerCase()}`, `Dash set the goal "${title}" to take its number from the ${choice.label.toLowerCase()}.`)
    : report('Set', ' to take readings typed in', `Dash set the goal "${title}" to take its number from readings typed in.`);
}

const LINK_CHANGES = ['link_aim', 'unlink_aim', 'link_job_search', 'unlink_job_search', 'link_row', 'unlink_row'] as const;
const LINKS = 'goals.links';

/**
 * Where each kind of listed row lives, what names it, and how a sentence
 * calls it (plan #2330.1). Dash finds the row by its ref or by its name among
 * the person's own rows of that table.
 */
const LISTED: Record<ListedKind, { schema: string; table: string; name: string; noun: string }> = {
  reading: { schema: 'learn', table: 'readings', name: 'title', noun: 'reading' },
  event: { schema: 'todo', table: 'events', name: 'title', noun: 'event' },
  saved_item: { schema: 'public', table: 'saved_items', name: 'title', noun: 'saved product' },
  contact: { schema: 'job_search', table: 'contacts', name: 'full_name', noun: 'contact' },
};

/**
 * One of the person's readings, events, saved products or contacts, by its
 * ref (`learn.readings:<id>`, or the id alone) or by its name: the one whose
 * name matches exactly, or the only one whose name holds the words.
 */
async function findListedRow(env: GoalsWriteEnv, kind: ListedKind, wanted: string): Promise<{ id: string; name: string }> {
  const listed = LISTED[kind];
  if (!wanted) throw new GoalsRefused(`target is missing: name the ${listed.noun}, or give the ref a lookup returned.`);
  const ref = parseRef(wanted);
  const id = ref ? ref.id : isUuid(wanted) ? wanted : null;
  if (ref && ref.table !== `${listed.schema}.${listed.table}`) {
    throw new GoalsRefused(`That ref is not one of their ${listed.noun}s. Give a ${listed.schema}.${listed.table} ref.`);
  }
  const table = env.goals.schema(listed.schema).from(listed.table);
  if (id) {
    const { data, error } = await table.select(`id, ${listed.name}`).eq('user_id', env.userId).eq('id', id).maybeSingle();
    if (error) throw new Error(`Reading the ${listed.noun} failed: ${error.message}`);
    const row = data as Row | null;
    if (!row) throw new GoalsRefused(`There is no ${listed.noun} of theirs with that ref. Look it up first.`);
    return { id: row.id as string, name: named(row[listed.name], `the ${listed.noun}`) };
  }
  const { data, error } = await table.select(`id, ${listed.name}`).eq('user_id', env.userId);
  if (error) throw new Error(`Reading the ${listed.noun}s failed: ${error.message}`);
  const rows = ((data ?? []) as Row[]).map((row) => ({ id: row.id as string, name: String(row[listed.name] ?? '').trim() }));
  const key = wanted.toLowerCase();
  const exact = rows.filter((row) => row.name.toLowerCase() === key);
  const holding = exact.length > 0 ? exact : rows.filter((row) => row.name.toLowerCase().includes(key));
  if (holding.length === 1) return { id: holding[0].id, name: named(holding[0].name, `the ${listed.noun}`) };
  if (holding.length > 1) {
    const some = holding.slice(0, 5).map((row) => `"${named(row.name, 'untitled')}"`).join(', ');
    throw new GoalsRefused(`More than one ${listed.noun} of theirs matches "${wanted}": ${some}. Give its ref instead.`);
  }
  throw new GoalsRefused(`They have no ${listed.noun} called "${wanted}". Look it up first.`);
}

/**
 * A goal listing one of the person's readings, events, saved products or
 * contacts, or no longer (plan #2330.1). The goal points at the row; nothing
 * is copied and nothing in the row's workspace changes. Linking a row the
 * goal already lists under another list name moves it to that list.
 */
async function changeGoalRow(env: GoalsWriteEnv, args: Args, change: 'link_row' | 'unlink_row'): Promise<GoalsMade> {
  const kind = text(args, 'kind');
  if (!isListedKind(kind)) throw new GoalsRefused(`kind must be one of ${LISTED_KINDS.join(', ')}.`);
  const goal = await ownGoal(env, text(args, 'goal_ref'));
  const goalId = goal.id as string;
  const title = named(goal.title, 'the goal');
  // A step of the goal's can hold the row instead, so buying a product
  // linked to "Get a pantry" closes that step (plan #2330.5).
  const stepRef = text(args, 'step_ref');
  const step = stepRef ? await ownStep(env, stepRef, 'step_ref') : null;
  if (step) {
    if (step.archived_at != null) throw new GoalsRefused('That step is archived. Restore it first.');
    if ((await goalAbove(env, step)).id !== goalId) throw new GoalsRefused('That step is not under that goal.');
  }
  const itemId = step ? (step.id as string) : goalId;
  const holder = step ? `the step "${named(step.title, 'the step')}"` : `the goal "${title}"`;
  const holderShort = step ? named(step.title, 'the step') : title;
  const holderNoun = step ? 'That step' : 'That goal';
  const target = await findListedRow(env, kind, text(args, 'target'));
  const noun = LISTED[kind].noun;
  const what = `the ${noun} "${target.name}"`;

  const readLink = async (): Promise<Row | null> => {
    const { data, error } = await env.goals
      .from('links')
      .select('*')
      .eq('user_id', env.userId)
      .eq('item_id', itemId)
      .eq('kind', kind)
      .eq('target_id', target.id)
      .maybeSingle();
    if (error) throw new Error(`Reading the goal's links failed: ${error.message}`);
    return (data as Row | null) ?? null;
  };
  const before = await readLink();
  const live = before != null && before.archived_at == null;
  const linking = change === 'link_row';
  // A name given is the list; none keeps a live link's list, or puts a new
  // link in the kind's own.
  const asked = 'list' in args ? parseListName(args.list) : undefined;

  if (linking) {
    const was = live ? listNameOf({ kind, listName: (before.list_name as string | null) ?? null }) : null;
    const into = listNameOf({ kind, listName: asked === undefined ? ((before?.list_name as string | null) ?? null) : asked });
    if (live && (asked === undefined || was?.toLowerCase() === into.toLowerCase())) {
      throw new GoalsRefused(`${holderNoun} lists ${what} in "${was}" already.`);
    }
    const linked = await linkTarget(await env.write({}), env.userId, itemId, kind, target.id, asked);
    if (!linked) throw new GoalsRefused(`${holderNoun} could not list ${what}.`);
    const after = await readLink();
    if (!after) throw new Error('The link was written but could not be read back.');
    const moved = live;
    return {
      kind: 'change_goal_link',
      input: {
        verb: moved ? 'Moved' : 'Listed',
        what: target.name,
        rest: ` in "${into}" on ${holderShort}`,
        href: goalHref(goalId),
        where: 'Open the goal',
        paths: [...GOAL_PATHS, goalHref(goalId)],
      },
      subjectRef: toRef(LINKS, after.id as string),
      op: before ? 'update' : 'insert',
      before,
      after,
      undo: null,
      summary: moved
        ? `Dash moved ${what} to the list "${into}" on ${holder}.`
        : `Dash listed ${what} in "${into}" on ${holder}.`,
      row: { table: ITEM, ref: goalId, title, href: goalHref(goalId) },
    };
  }

  if (!live) throw new GoalsRefused(`${holderNoun} does not list ${what}.`);
  if (!(await unlinkTarget(await env.write({}), before.id as string))) throw new GoalsRefused('That link has already gone.');
  const after = await readLink();
  if (!after) throw new Error('The link was written but could not be read back.');
  const from = listNameOf({ kind, listName: (before.list_name as string | null) ?? null });
  return {
    kind: 'change_goal_link',
    input: {
      verb: 'Took',
      what: target.name,
      rest: ` off "${from}" on ${holderShort}`,
      href: goalHref(goalId),
      where: 'Open the goal',
      paths: [...GOAL_PATHS, goalHref(goalId)],
    },
    subjectRef: toRef(LINKS, after.id as string),
    op: 'update',
    before,
    after,
    undo: null,
    summary: `Dash took ${what} off the list "${from}" on ${holder}.`,
    row: { table: ITEM, ref: goalId, title, href: goalHref(goalId) },
  };
}

/** One of the person's live Learn goals, by its learn.aims ref or its name. */
async function findAim(env: GoalsWriteEnv, wanted: string): Promise<Row> {
  if (!wanted) throw new GoalsRefused('aim is missing: name the Learn goal, or give its learn.aims ref.');
  const { data, error } = await env.goals
    .schema('learn')
    .from('aims')
    .select('id, name')
    .eq('user_id', env.userId)
    .is('archived_at', null);
  if (error) throw new Error(`Reading the Learn goals failed: ${error.message}`);
  const aims = (data ?? []) as Row[];
  const key = wanted.toLowerCase();
  const found = aims.find((a) => a.id === wanted || String(a.name).trim().toLowerCase() === key);
  if (found) return found;
  throw new GoalsRefused(
    aims.length > 0
      ? `They have no Learn goal called "${wanted}". Theirs are ${aims.map((a) => `"${a.name}"`).join(', ')}.`
      : 'They have no Learn goals yet.',
  );
}

/** Linking a goal to a Learn goal or to the job search, or no longer: a goals.links row, archived to unlink. */
async function changeGoalLink(env: GoalsWriteEnv, args: Args): Promise<GoalsMade> {
  const change = oneOf(args, LINK_CHANGES);
  if (change === 'link_row' || change === 'unlink_row') return changeGoalRow(env, args, change);
  const goal = await ownGoal(env, text(args, 'goal_ref'));
  const goalId = goal.id as string;
  const title = named(goal.title, 'the goal');
  const toAim = change === 'link_aim' || change === 'unlink_aim';
  const aim = toAim ? await findAim(env, text(args, 'aim')) : null;
  const targetId = aim ? (aim.id as string) : null;
  const target = aim ? `the Learn goal "${named(aim.name, 'it')}"` : 'the job search';

  const readLink = async (): Promise<Row | null> => {
    let query = env.goals
      .from('links')
      .select('*')
      .eq('user_id', env.userId)
      .eq('item_id', goalId)
      .eq('kind', toAim ? 'aim' : 'job_search');
    query = targetId ? query.eq('target_id', targetId) : query.is('target_id', null);
    const { data, error } = await query.maybeSingle();
    if (error) throw new Error(`Reading the goal's links failed: ${error.message}`);
    return (data as Row | null) ?? null;
  };
  const before = await readLink();
  const live = before != null && before.archived_at == null;
  const linking = change === 'link_aim' || change === 'link_job_search';

  if (linking) {
    if (live) throw new GoalsRefused(`That goal is linked to ${target} already.`);
    const linked = await linkTarget(await env.write({}), env.userId, goalId, toAim ? 'aim' : 'job_search', targetId);
    if (!linked) throw new GoalsRefused(`That goal could not be linked to ${target}.`);
  } else {
    if (!live) throw new GoalsRefused(`That goal is not linked to ${target}.`);
    if (!(await unlinkTarget(await env.write({}), before.id as string))) throw new GoalsRefused('That link has already gone.');
  }
  const after = await readLink();
  if (!after) throw new Error('The link was written but could not be read back.');
  return {
    kind: 'change_goal_link',
    input: {
      verb: linking ? 'Linked' : 'Unlinked',
      what: title,
      rest: `${linking ? ' to' : ' from'} ${target}`,
      href: goalHref(goalId),
      where: 'Open the goal',
      paths: [...GOAL_PATHS, goalHref(goalId)],
    },
    subjectRef: toRef(LINKS, after.id as string),
    op: before ? 'update' : 'insert',
    before,
    after,
    undo: null,
    summary: linking ? `Dash linked the goal "${title}" to ${target}.` : `Dash unlinked the goal "${title}" from ${target}.`,
    row: { table: ITEM, ref: goalId, title, href: goalHref(goalId) },
  };
}

const FORM_CHANGES = [
  'set_questions',
  'add_record',
  'edit_record',
  'archive_record',
  'restore_record',
  'edit_document_kind',
  'forget_document_kind',
] as const;
type FormChange = (typeof FORM_CHANGES)[number];
const RECORDS = 'goals.records';
const KINDS = 'goals.document_kinds';

/** A record as the person reads it: its first few values, in the form's order. */
function describeRecord(fields: CollectionField[], data: unknown): string {
  const values = (data ?? {}) as Record<string, unknown>;
  const parts = fields
    .filter((f) => !f.removed)
    .map((f) => values[f.key])
    .filter((v) => v !== null && v !== undefined && v !== '')
    .slice(0, 3)
    .map(String);
  return parts.length > 0 ? parts.join(', ') : 'an empty row';
}

/** One record in the step's collection, by its goals.records ref or by words in its values. */
async function findRecord(env: GoalsWriteEnv, collectionId: string, fields: CollectionField[], wanted: string, archived: boolean): Promise<Row> {
  if (!wanted) throw new GoalsRefused('record is missing: give words from the row, such as its name, or its goals.records ref.');
  let query = env.goals.from('records').select('*').eq('user_id', env.userId).eq('collection_id', collectionId);
  query = archived ? query.not('archived_at', 'is', null) : query.is('archived_at', null);
  const { data, error } = await query.order('position', { ascending: true });
  if (error) throw new Error(`Reading the rows failed: ${error.message}`);
  const rows = (data ?? []) as Row[];
  const byId = rows.find((r) => r.id === wanted);
  if (byId) return byId;
  const words = wanted.toLowerCase().split(/\s+/).filter(Boolean);
  const said = (r: Row) => Object.values((r.data ?? {}) as Record<string, unknown>).map(String).join(' ').toLowerCase();
  const matches = rows.filter((r) => words.every((w) => said(r).includes(w)));
  if (matches.length === 1) return matches[0];
  const list = (matches.length > 1 ? matches : rows).slice(0, 10).map((r) => `"${describeRecord(fields, r.data)}"`).join(', ');
  if (rows.length === 0) throw new GoalsRefused(archived ? 'That form has no archived rows.' : 'That form has no rows.');
  throw new GoalsRefused(
    matches.length > 1
      ? `More than one row matches "${wanted}": ${list}. Say which.`
      : `No ${archived ? 'archived ' : ''}row matches "${wanted}". The rows are ${list}.`,
  );
}

/** One of the kinds of document the step's form has learned, by its name or goals.document_kinds ref. */
async function findKind(env: GoalsWriteEnv, collectionId: string, wanted: string): Promise<Row> {
  if (!wanted) throw new GoalsRefused('document_kind is missing: name the kind of document, or give its goals.document_kinds ref.');
  const { data, error } = await env.goals
    .from('document_kinds')
    .select('*')
    .eq('user_id', env.userId)
    .eq('collection_id', collectionId)
    .is('archived_at', null);
  if (error) throw new Error(`Reading the kinds of document failed: ${error.message}`);
  const kinds = (data ?? []) as Row[];
  const key = wanted.toLowerCase();
  const found = kinds.find((k) => k.id === wanted || String(k.name).trim().toLowerCase() === key);
  if (found) return found;
  throw new GoalsRefused(
    kinds.length > 0
      ? `That form knows no kind of document called "${wanted}". It knows ${kinds.map((k) => `"${k.name}"`).join(', ')}.`
      : 'That form has learned no kinds of document yet.',
  );
}

function stringList(args: Args, key: string): string[] | null {
  const value = args[key];
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value.split('\n');
  if (Array.isArray(value)) return value.map((v) => (typeof v === 'string' ? v : String(v)));
  throw new GoalsRefused(`${key} must be a list of lines.`);
}

/** The questions as the person's form keeps them: a wording already there keeps its key, so its answer stays with it. */
function nextQuestions(existing: StepQuestion[], wanted: string[]): StepQuestion[] {
  const out: StepQuestion[] = [];
  const taken = new Set(existing.map((q) => q.key));
  for (const raw of wanted) {
    const question = raw.trim().replace(/\s+/g, ' ');
    if (!question) continue;
    if (question.length > MAX_QUESTION_LENGTH) throw new GoalsRefused(`A question can be at most ${MAX_QUESTION_LENGTH} characters.`);
    const kept = existing.find((q) => q.question.trim().toLowerCase() === question.toLowerCase() && !out.some((o) => o.key === q.key));
    if (kept) {
      out.push({ key: kept.key, question });
      continue;
    }
    const key = questionKey(question, taken);
    taken.add(key);
    out.push({ key, question });
  }
  if (out.length > MAX_QUESTIONS) throw new GoalsRefused(`A step can hold at most ${MAX_QUESTIONS} questions.`);
  return out;
}

/**
 * The values a row is given, by field key or label, as the record check takes them. A
 * label that names no field is passed on under its own words, so the check refuses it.
 */
function recordValues(fields: CollectionField[], args: Args): Record<string, unknown> {
  const raw = args.values;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new GoalsRefused(
      `values is missing: give the row's values by field, such as ${fields
        .filter((f) => !f.removed)
        .slice(0, 6)
        .map((f) => `"${f.label}"`)
        .join(', ')}.`,
    );
  }
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    const key = name.trim().toLowerCase();
    const field = fields.find((f) => !f.removed && (f.key === name || f.label.trim().toLowerCase() === key));
    out[field ? field.key : name] = value;
  }
  return out;
}

/**
 * Add a row to a form, or change one, when the person tells Dash its values
 * (note 75fdbf3d). The form is a step's, by step_ref, or one serving a goal,
 * by goal_ref and collection, such as the spaces list on a home goal. A row
 * added this way is the person's own, so it is not a draft.
 */
async function changeGoalRecord(env: GoalsWriteEnv, args: Args, change: 'add_record' | 'edit_record'): Promise<GoalsMade> {
  let collectionId: string;
  let owner: Row;
  if (text(args, 'step_ref')) {
    owner = await ownStep(env, text(args, 'step_ref'), 'step_ref');
    if (owner.archived_at != null) throw new GoalsRefused('That step is archived. Restore it first.');
    const id = owner.collection_id as string | null;
    if (!id) throw new GoalsRefused('That step has no form. Only a step that gathers information has one.');
    collectionId = id;
  } else {
    owner = await ownGoal(env, text(args, 'goal_ref'));
    const sources = await goalSources(env, owner.id as string);
    if (sources.length === 0) throw new GoalsRefused('No collection serves that goal.');
    const wanted = text(args, 'collection').toLowerCase();
    const found = wanted
      ? sources.filter((c) => c.id === wanted || c.name.trim().toLowerCase() === wanted || c.name.toLowerCase().includes(wanted))
      : sources;
    if (found.length !== 1) {
      const names = sources.map((c) => `"${c.name}"`).join(', ');
      throw new GoalsRefused(
        wanted && found.length === 0
          ? `That goal has no collection called "${text(args, 'collection')}". It has ${names}.`
          : `Say which collection: the goal has ${names}.`,
      );
    }
    collectionId = found[0].id;
  }
  const collection = await ownRow(env.goals, 'collections', collectionId, env.userId);
  if (!collection || collection.archived_at != null) throw new GoalsRefused('That collection is gone.');
  const fields = (collection.fields ?? []) as CollectionField[];
  const listName = named(collection.name, 'the list');
  const values = recordValues(fields, args);
  const goal = owner.level === 'goal' ? owner : await goalAbove(env, owner);
  const goalId = goal.id as string;
  const href = owner.level === 'goal' ? goalHref(goalId) : stepHref(goalId, owner.id as string);
  const title = named(owner.title, owner.level === 'goal' ? 'the goal' : 'the step');
  const input = (verb: string, what: string): GoalsChangeInput => ({
    verb,
    what,
    rest: ` in ${listName}`,
    href,
    where: owner.level === 'goal' ? 'Open the goal' : 'Open the step',
    paths: [...GOAL_PATHS, goalHref(goalId)],
  });
  const row: AskRow = { table: ITEM, ref: owner.id as string, title, href };
  const client = await env.write({});

  if (change === 'add_record') {
    const { data: live, error: liveError } = await env.goals
      .from('records')
      .select('id')
      .eq('user_id', env.userId)
      .eq('collection_id', collectionId)
      .is('archived_at', null);
    if (liveError) throw new Error(`Reading the rows failed: ${liveError.message}`);
    const count = (live ?? []).length;
    if (collection.shape === 'one' && count > 0) {
      throw new GoalsRefused(`${listName} holds one row and already has it. Change it with edit_record.`);
    }
    const checked = checkRecord(fields, values, null);
    if (!checked.ok) throw new GoalsRefused(checked.error);
    if (Object.keys(checked.data).length === 0) throw new GoalsRefused('Those values fill in no field, so there is no row to add.');
    const { data, error } = await client
      .from('records')
      .insert({ user_id: env.userId, collection_id: collectionId, data: checked.data, source: 'typed', draft: false, position: count })
      .select('*')
      .single();
    if (error) throw new GoalsRefused(`The row could not be added: ${error.message}`);
    const after = data as Row;
    const said = describeRecord(fields, after.data);
    return {
      kind: 'change_goal_form',
      input: input('Added', said),
      subjectRef: toRef(RECORDS, after.id as string),
      op: 'insert',
      before: null,
      after,
      undo: null,
      summary: `Dash added "${said}" to ${listName} on "${title}".`,
      row,
    };
  }

  const before = await findRecord(env, collectionId, fields, text(args, 'record'), false);
  const checked = checkRecord(fields, values, (before.data ?? {}) as RecordValues);
  if (!checked.ok) throw new GoalsRefused(checked.error);
  if (JSON.stringify(checked.data) === JSON.stringify(before.data ?? {})) throw new GoalsRefused('That row has those values already.');
  const { error } = await client
    .from('records')
    .update({ data: checked.data, source: 'typed', draft: false })
    .eq('id', before.id as string)
    .eq('user_id', env.userId);
  if (error) throw new GoalsRefused(`The row could not be changed: ${error.message}`);
  const after = await ownRow(env.goals, 'records', before.id as string, env.userId);
  const said = describeRecord(fields, after?.data);
  return {
    kind: 'change_goal_form',
    input: input('Changed', said),
    subjectRef: toRef(RECORDS, before.id as string),
    op: 'update',
    before,
    after,
    undo: null,
    summary: `Dash changed the row "${describeRecord(fields, before.data)}" in ${listName} on "${title}"${said !== describeRecord(fields, before.data) ? `, now "${said}"` : ''}.`,
    row,
  };
}

/** An information step's form: its questions, its rows, and the kinds of document it has learned to read. */
async function changeGoalForm(env: GoalsWriteEnv, args: Args): Promise<GoalsMade> {
  const change: FormChange = oneOf(args, FORM_CHANGES);
  if (change === 'add_record' || change === 'edit_record') return changeGoalRecord(env, args, change);
  const step = await ownStep(env, text(args, 'step_ref'), 'step_ref');
  if (step.archived_at != null) throw new GoalsRefused('That step is archived. Restore it first.');
  const collectionId = step.collection_id as string | null;
  if (!collectionId) throw new GoalsRefused('That step has no form. Only a step that gathers information has one.');
  const collection = await ownRow(env.goals, 'collections', collectionId, env.userId);
  if (!collection) throw new GoalsRefused('The collection behind that step is gone.');
  const fields = (collection.fields ?? []) as CollectionField[];
  const goal = await goalAbove(env, step);
  const stepId = step.id as string;
  const goalId = goal.id as string;
  const title = named(step.title, 'the step');
  const href = stepHref(goalId, stepId);
  const made = (
    table: string,
    before: Row,
    after: Row | null,
    words: { verb: string; what: string; rest: string; summary: string },
  ): GoalsMade => ({
    kind: 'change_goal_form',
    input: { verb: words.verb, what: words.what, rest: words.rest, href, where: 'Open the step', paths: [...GOAL_PATHS, goalHref(goalId)] },
    subjectRef: toRef(table, before.id as string),
    op: 'update',
    before,
    after,
    undo: null,
    summary: words.summary,
    row: { table: ITEM, ref: stepId, title, href },
  });

  switch (change) {
    case 'set_questions': {
      const existing = readQuestions(step.questions);
      const wanted = stringList(args, 'questions');
      if (wanted === null) {
        throw new GoalsRefused(
          existing.length > 0
            ? `questions is missing: send the whole list. The step asks ${existing.map((q) => `"${q.question}"`).join(', ')}.`
            : 'questions is missing: send the whole list. The step asks nothing yet.',
        );
      }
      const questions = nextQuestions(existing, wanted);
      if (JSON.stringify(questions) === JSON.stringify(existing)) throw new GoalsRefused('The step asks those questions already.');
      const status = await guarded('They could not be saved', async () => setStepQuestions(await env.write({}), stepId, questions));
      if (!status) throw new GoalsRefused('That step no longer has a form.');
      const after = await ownRow(env.goals, 'items', stepId, env.userId);
      const closed = step.status !== 'done' && status === 'done' ? ' Every one already had its answer, so the step closed.' : '';
      return made(ITEM, step, after, {
        verb: questions.length > 0 ? 'Set the questions on' : 'Cleared the questions on',
        what: title,
        rest: '',
        summary:
          questions.length > 0
            ? `Dash set the ${questions.length === 1 ? 'question' : `${questions.length} questions`} the step "${title}" asks.${closed}`
            : `Dash cleared the questions on the step "${title}".`,
      });
    }
    case 'archive_record':
    case 'restore_record': {
      const archiving = change === 'archive_record';
      const before = await findRecord(env, collectionId, fields, text(args, 'record'), !archiving);
      const client = await env.write({});
      const changed = archiving ? await archiveRecord(client, before.id as string) : await restoreRecord(client, before.id as string);
      if (!changed) throw new GoalsRefused('That row has already changed.');
      const after = await ownRow(env.goals, 'records', before.id as string, env.userId);
      const said = describeRecord(fields, before.data);
      return made(RECORDS, before, after, {
        verb: archiving ? 'Archived' : 'Brought back',
        what: said,
        rest: ` on ${title}`,
        summary: archiving
          ? `Dash archived the row "${said}" on the step "${title}".`
          : `Dash brought back the row "${said}" on the step "${title}".`,
      });
    }
    case 'edit_document_kind': {
      const before = await findKind(env, collectionId, text(args, 'document_kind'));
      const name = 'name' in args ? text(args, 'name') : String(before.name);
      if (!name) throw new GoalsRefused('Give the kind a name.');
      if (name.length > KIND_NAME_MAX) throw new GoalsRefused(`A name can be at most ${KIND_NAME_MAX} characters.`);
      const recognise = 'recognise' in args ? text(args, 'recognise') : String(before.recognise ?? '');
      if (recognise.length > RECOGNISE_MAX) throw new GoalsRefused(`How to recognise it can be at most ${RECOGNISE_MAX} characters.`);
      const sendersSent = stringList(args, 'senders');
      const senders = sendersSent === null ? ((before.senders ?? []) as string[]) : parseSenders(sendersSent.join('\n'));
      const skippedSent = stringList(args, 'skipped');
      const skipped =
        skippedSent === null
          ? ((before.skipped ?? []) as string[])
          : [...new Set(skippedSent.map((line) => line.trim().slice(0, SKIPPED_LABEL_MAX)).filter(Boolean))].slice(0, SKIPPED_MAX);
      const edit = { name, recognise, senders, skipped };
      if (
        name === before.name &&
        recognise === (before.recognise ?? '') &&
        JSON.stringify(senders) === JSON.stringify(before.senders ?? []) &&
        JSON.stringify(skipped) === JSON.stringify(before.skipped ?? [])
      ) {
        throw new GoalsRefused('Nothing to change: give a new name, recognise, senders or skipped.');
      }
      const result = await editKind(await env.write({}), before.id as string, {
        ...edit,
        fieldNotes: (before.field_notes ?? {}) as Record<string, string>,
      });
      if (!result.ok) throw new GoalsRefused(result.error);
      const after = await ownRow(env.goals, 'document_kinds', before.id as string, env.userId);
      const was = named(before.name, 'the kind');
      return made(KINDS, before, after, {
        verb: 'Changed',
        what: was,
        rest: name !== before.name ? ` to ${name}` : '',
        summary: `Dash changed how the step "${title}" reads ${was}${name !== before.name ? `, now called ${name}` : ''}.`,
      });
    }
    case 'forget_document_kind': {
      const before = await findKind(env, collectionId, text(args, 'document_kind'));
      if (!(await forgetKind(await env.write({}), before.id as string))) throw new GoalsRefused('That kind is already gone.');
      const after = await ownRow(env.goals, 'document_kinds', before.id as string, env.userId);
      const was = named(before.name, 'the kind');
      return made(KINDS, before, after, {
        verb: 'Forgot',
        what: was,
        rest: ` on ${title}`,
        summary: `Dash made the step "${title}" forget ${was}, so the next one is read as new.`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// change_goals_inbox (plan #1894.7.4)
// ---------------------------------------------------------------------------

const INBOX_CHANGES = ['snooze', 'unsnooze', 'went', 'did_not_go'] as const;
const SNOOZES = 'core.inbox_snoozes';
const SUGGESTIONS = 'goals.suggestions';
const INBOX_HREF = '/goals/inbox';
const INBOX_PATHS = ['/goals', '/goals/inbox', '/home'];

/** A Goals row the Inbox can snooze: a live goal or step of theirs, by its goals.items ref. */
async function snoozable(env: GoalsWriteEnv, id: string): Promise<Row> {
  if (!id) throw new GoalsRefused('row_ref is missing: give the goals.items ref a lookup returned for the goal or step.');
  if (!isUuid(id)) throw new GoalsRefused("row_ref must be a goal or step's goals.items ref, as a lookup returned it.");
  const row = await ownRow(env.goals, 'items', id, env.userId);
  if (!row) throw new GoalsRefused('There is no goal or step of theirs with that row_ref. Look it up first.');
  if (row.archived_at != null) throw new GoalsRefused('That row is archived, so it is not in the Inbox.');
  return row;
}

async function readSnooze(core: SchemaClient, userId: string, ref: string): Promise<Row | null> {
  const { data, error } = await core.from('inbox_snoozes').select('*').eq('user_id', userId).eq('ref', ref).maybeSingle();
  if (error) throw new Error(`Reading the snooze failed: ${error.message}`);
  return (data as Row | null) ?? null;
}

async function changeGoalsInbox(env: GoalsWriteEnv, args: Args): Promise<GoalsMade> {
  const change = oneOf(args, INBOX_CHANGES);
  if (change === 'went' || change === 'did_not_go') return recordWent(env, change === 'went', text(args, 'event'));

  const core = env.core;
  if (!core) throw new GoalsRefused('Snoozing is not reachable from here. They can snooze the row on the Goals Inbox.');
  const item = await snoozable(env, text(args, 'row_ref'));
  const id = item.id as string;
  const ref = toRef(ITEM, id);
  const title = named(item.title, item.level === 'goal' ? 'the goal' : 'the step');
  const before = await readSnooze(core, env.userId, ref);
  const row: AskRow = { table: ITEM, ref: id, title, href: INBOX_HREF };
  const input = (verb: string, rest: string): GoalsChangeInput => ({
    verb,
    what: title,
    rest,
    href: INBOX_HREF,
    where: 'Open the Inbox',
    paths: INBOX_PATHS,
  });

  if (change === 'snooze') {
    const day = snoozeDay(text(args, 'until'), todayOf(env));
    if (!day) throw new GoalsRefused(`until must be ${SNOOZE_CHOICES.join(', ')}, or a day after today as YYYY-MM-DD.`);
    const outcome = await snoozeRow(core, { userId: env.userId, ref, until: dayStartIn(day, env.timezone ?? 'UTC') });
    if (outcome.error) throw new GoalsRefused(outcome.error);
    const after = await readSnooze(core, env.userId, ref);
    if (!after) throw new Error('The snooze was written but could not be read back.');
    return {
      kind: 'change_goals_inbox',
      input: input('Snoozed', ` until ${day}`),
      subjectRef: toRef(SNOOZES, after.id as string),
      op: before ? 'update' : 'insert',
      before,
      after,
      undo: null,
      summary: `Dash snoozed "${title}" on the Goals Inbox until ${day}.`,
      row,
    };
  }

  if (!before || Date.parse(String(before.snoozed_until)) <= Date.now()) {
    throw new GoalsRefused('That row is not snoozed, so it is in the Inbox already.');
  }
  const outcome = await unsnoozeRow(core, { userId: env.userId, ref });
  if (outcome.error) throw new GoalsRefused(outcome.error);
  return {
    kind: 'change_goals_inbox',
    input: input('Brought back', ''),
    subjectRef: toRef(SNOOZES, before.id as string),
    op: 'delete',
    before,
    after: null,
    undo: null,
    summary: `Dash brought "${title}" back to the Goals Inbox from its snooze.`,
    row,
  };
}

/** Whether they went to an event they said they were going to: a goals.suggestions row, named in words. */
async function recordWent(env: GoalsWriteEnv, went: boolean, wanted: string): Promise<GoalsMade> {
  if (!wanted) throw new GoalsRefused('event is missing: name the event in their words, or give its goals.suggestions ref.');
  const { data, error } = await env.goals
    .from('suggestions')
    .select('*')
    .eq('user_id', env.userId)
    .eq('reaction', 'going')
    .is('attended', null);
  if (error) throw new Error(`Reading the suggestions failed: ${error.message}`);
  const waiting = (data ?? []) as Row[];
  const lower = wanted.toLowerCase();
  const matches = isUuid(wanted)
    ? waiting.filter((row) => row.id === wanted)
    : waiting.filter((row) => String(row.title ?? '').toLowerCase().includes(lower));
  const choices = () =>
    waiting.length === 0
      ? 'No event they said they were going to is waiting for an answer.'
      : `The events waiting for an answer: ${waiting.map((row) => `"${named(row.title, 'an event')}"`).join(', ')}.`;
  if (matches.length === 0) throw new GoalsRefused(`No event they are going to matches "${wanted}". ${choices()}`);
  if (matches.length > 1) throw new GoalsRefused(`More than one event matches "${wanted}". ${choices()}`);
  const before = matches[0];
  const id = before.id as string;
  const title = named(before.title, 'the event');
  const today = todayOf(env);
  const on = (before.happens_on as string | null) ?? null;
  if (on && on > today) throw new GoalsRefused(`"${title}" is on ${on}, which is still to come.`);

  // Going to an event for a rhythm also counts once towards it, on a second row, so that answer has no Undo here.
  let counted = false;
  if (went && before.item_id) {
    const item = await ownRow(env.goals, 'items', before.item_id as string, env.userId);
    counted = item?.kind === 'rhythm';
  }
  const changed = await guarded('It could not be recorded', async () => recordAttended(await env.write({}), id, went, today));
  if (!changed) throw new GoalsRefused('That has already been answered.');
  const after = await ownRow(env.goals, 'suggestions', id, env.userId);
  return {
    kind: 'change_goals_inbox',
    input: {
      verb: went ? 'Went to' : 'Did not go to',
      what: title,
      rest: '',
      href: INBOX_HREF,
      where: 'Open the Inbox',
      paths: [...INBOX_PATHS, '/todo'],
    },
    subjectRef: toRef(SUGGESTIONS, id),
    op: 'update',
    before,
    after,
    undo: counted
      ? { none: 'Going was counted towards the rhythm it served as well, so the count is taken back on the goal page.' }
      : null,
    summary: went
      ? `Dash recorded that they went to "${title}"${counted ? ', and counted it towards the rhythm it served' : ''}.`
      : `Dash recorded that they did not go to "${title}".`,
    row: { table: SUGGESTIONS, ref: id, title, href: INBOX_HREF },
  };
}

// ---------------------------------------------------------------------------
// The tools
// ---------------------------------------------------------------------------

export const GOALS_WRITES: readonly GoalsWrite[] = [
  {
    name: 'change_goal_area',
    runs: sameAs(
      ['app/goals/actions.ts#renameAreaAction', 'lib/goals/store.ts#renameArea'],
      ['app/goals/actions.ts#setAreaNoteAction', 'lib/goals/store.ts#setAreaNote'],
      ['app/goals/actions.ts#moveAreaAction', 'lib/goals/store.ts#moveArea'],
      ['app/goals/actions.ts#archiveAreaAction', 'lib/goals/store.ts#archiveArea'],
    ),
    description:
      "Change one of the person's areas in Goals, when they ask: add a new area (change add, with name), rename one (rename, with name), write or clear what they want from it (note; an empty note clears it), move it up or down the list (move_up, move_down), archive it with the goals in it (archive), or bring an archived one back with them (restore). Name the area by its name as they have it, or by the goals.areas ref a lookup returned. A goal under an area is add_goal or change_goal.",
    input_schema: {
      type: 'object',
      properties: {
        change: { type: 'string', enum: [...AREA_CHANGES], description: 'What to do to the area.' },
        area: { type: 'string', description: 'The area: its name as they have it, or its goals.areas ref. Not needed for add.' },
        name: { type: 'string', description: 'For add and rename: the new name, short ("Music").' },
        note: { type: 'string', description: 'For note: what they want from the area, in their words; empty to clear it.' },
      },
      required: ['change'],
      additionalProperties: false,
    },
    run: changeGoalArea,
  },
  {
    name: 'change_goal',
    runs: sameAs(
      ['app/goals/actions.ts#editGoal', 'lib/goals/store.ts#updateGoal'],
      ['app/goals/actions.ts#moveGoalAction', 'lib/goals/store.ts#moveGoal'],
      ['app/goals/actions.ts#archiveGoalAction', 'lib/goals/store.ts#setGoalArchived'],
      ['app/goals/actions.ts#settleGoalAction', 'lib/goals/store.ts#settleGoal'],
    ),
    description:
      "Change one of the person's goals in Goals, when they ask: reword it, set or clear its due date, or move it to another area (change edit, with any of title, due_on, due_precision and area), move it up or down in its area (move_up, move_down), archive it or bring it back (archive, restore), close it as done, park it for now, or take a parked or closed goal back up (close, park, reopen). Name the goal by the goals.items ref search (kinds [\"goal\"]) or goal_status returned for it; look it up first. Write the title as an outcome. The done-when is set_goal_done_when; a step under the goal is add_goal_step or close_goal_step.",
    input_schema: {
      type: 'object',
      properties: {
        change: { type: 'string', enum: [...GOAL_CHANGES], description: 'What to do to the goal.' },
        goal_ref: { type: 'string', description: 'The goals.items ref a lookup returned for the goal.' },
        title: { type: 'string', description: 'For edit: the new wording, as an outcome.' },
        due_on: { type: 'string', description: 'For edit: the date it is due by, YYYY-MM-DD; empty to clear it.' },
        due_precision: {
          type: 'string',
          enum: [...DUE_PRECISIONS],
          description: 'For edit, with due_on: what the date is the end of, when they named a month, quarter, half or year. Default day.',
        },
        area: { type: 'string', description: 'For edit: the area to move it to, by its name or goals.areas ref.' },
      },
      required: ['change', 'goal_ref'],
      additionalProperties: false,
    },
    run: changeGoal,
  },
  {
    name: 'change_goal_step',
    runs: sameAs(
      ['app/goals/[goalId]/actions.ts#editStep', 'lib/goals/steps-store.ts#updateStep'],
      ['app/goals/[goalId]/actions.ts#setStepStatusAction', 'lib/goals/steps-store.ts#setStepStatus'],
      ['app/goals/[goalId]/actions.ts#moveStepAction', 'lib/goals/steps-store.ts#moveStep'],
      ['app/goals/[goalId]/actions.ts#archiveStepAction', 'lib/goals/steps-store.ts#setStepArchived'],
      ['app/goals/[goalId]/actions.ts#linkStepAction', 'lib/goals/steps-store.ts#linkStep'],
      ['app/goals/[goalId]/actions.ts#unlinkStepAction', 'lib/goals/steps-store.ts#unlinkStep'],
      ['app/goals/[goalId]/block-actions.ts#setGoalStepStatus', 'lib/goals/steps-store.ts#setStepStatus'],
      ['app/goals/[goalId]/block-actions.ts#blockGoalStep', 'app/goals/[goalId]/block-actions.ts#blockGoalStep'],
      ['app/goals/[goalId]/block-actions.ts#addGoalStepDependency', 'lib/goals/steps-store.ts#insertDependency'],
      ['app/goals/[goalId]/block-actions.ts#removeGoalStepDependency', 'lib/goals/steps-store.ts#deleteDependency'],
      ['app/goals/home-actions.ts#setAsideAction', 'lib/core/snooze-days.ts#snoozeDay'],
      ['app/goals/home-actions.ts#restoreAsideAction', 'lib/goals/steps-store.ts#updateStep'],
      ['app/goals/home-actions.ts#bringBackAction', 'lib/goals/steps-store.ts#updateStep'],
    ),
    description:
      "Change one of the person's steps under a goal, when they ask: reword it or change its detail, done-when, dates or kind (change edit, with any of title, detail, done_when, due_on, starts_on, kind, rhythm_count and rhythm_period; an empty detail, done_when or date clears it), drop it (drop), set a done, dropped or blocked step open again (reopen), block it with what it needs (block, with needs), move it up or down among its siblings (move_up, move_down), archive it or bring it back (archive, restore), count it towards another goal as well or no longer (count_towards, stop_counting, with goal_ref), or make it wait on another step until that one closes, or no longer (wait_on, stop_waiting, with other_step_ref), set it aside until a later day so it leaves Up next (set_aside, with until), bring a set-aside step back now (bring_back), or make it its own errand, due on due_on or the step's own date, in area or the goal's, and archive the step (make_errand). Name steps by the goals.items refs a lookup returned; look them up first. Marking a step done is close_goal_step; a new step is add_goal_step.",
    input_schema: {
      type: 'object',
      properties: {
        change: { type: 'string', enum: [...STEP_CHANGES], description: 'What to do to the step.' },
        step_ref: { type: 'string', description: 'The goals.items ref a lookup returned for the step.' },
        title: { type: 'string', description: 'For edit: the new wording.' },
        detail: { type: 'string', description: "For edit: the step's detail; empty to clear it." },
        done_when: { type: 'string', description: 'For edit: when the step counts as done; empty to clear it.' },
        due_on: {
          type: 'string',
          description: "For edit: the date it is due by, YYYY-MM-DD; empty to clear it. For make_errand: the errand's due date, when they give one.",
        },
        area: { type: 'string', description: "For make_errand: the area the errand goes in, by name or goals.areas ref; the goal's area when left out." },
        starts_on: { type: 'string', description: 'For edit: the date it starts, YYYY-MM-DD; empty to clear it.' },
        kind: {
          type: 'string',
          enum: [...STEP_KINDS],
          description: 'For edit: mine (theirs to do), claude (for Dash to do), decision, or rhythm (with rhythm_count).',
        },
        rhythm_count: { type: 'integer', description: 'For edit, on a rhythm: how many times each period.' },
        rhythm_period: { type: 'string', enum: [...RHYTHM_PERIODS], description: 'For edit, on a rhythm: per day, week or month.' },
        needs: { type: 'string', description: 'For block: what the step is waiting for, in one sentence.' },
        block_kind: {
          type: 'string',
          enum: ['outside', 'steps'],
          description: 'For block: outside when it waits on them or something outside, steps when it clears itself once the steps it waits on close. Default outside.',
        },
        goal_ref: { type: 'string', description: 'For count_towards and stop_counting: the goals.items ref of the other goal.' },
        other_step_ref: { type: 'string', description: 'For wait_on and stop_waiting: the goals.items ref of the step it waits on.' },
        until: {
          type: 'string',
          description: 'For set_aside: tomorrow, weekend, next_week, next_month, or a day after today as YYYY-MM-DD. A due date before it moves with it.',
        },
      },
      required: ['change', 'step_ref'],
      additionalProperties: false,
    },
    run: changeGoalStep,
  },
  {
    name: 'change_goal_number',
    runs: sameAs(
      ['app/goals/[goalId]/reading-actions.ts#setMeasureAction', 'lib/goals/readings-store.ts#setGoalMeasure'],
      ['app/goals/[goalId]/reading-actions.ts#setNumberFromAction', 'lib/goals/readings-store.ts#setNumberFrom'],
    ),
    description:
      "Change how one of the person's goals is measured, when they ask: set the unit and the target it aims for (change measure, with unit and target; an empty unit stops measuring it by a number), or work its number out from a collection serving it, or go back to readings typed in (number_from, with from naming the choice, such as \"Total balance of Loans\", or \"Number of Events with status Went\" to count only the rows of a list holding one option; empty for typed readings). Name the goal by the goals.items ref a lookup returned. A wrong from is refused with the choices the goal has.",
    input_schema: {
      type: 'object',
      properties: {
        change: { type: 'string', enum: [...NUMBER_CHANGES], description: 'What to change.' },
        goal_ref: { type: 'string', description: 'The goals.items ref a lookup returned for the goal.' },
        unit: { type: 'string', description: 'For measure: what the number counts ("km", "$", "books"); empty to stop measuring.' },
        target: { type: 'number', description: 'For measure: the number it aims for. Leave out for none.' },
        from: { type: 'string', description: 'For number_from: the choice, as "Total <field> of <collection>", "Latest <field> of <collection>" or "Number of <collection>"; empty for readings typed in.' },
      },
      required: ['change', 'goal_ref'],
      additionalProperties: false,
    },
    run: changeGoalNumber,
  },
  {
    name: 'change_goal_link',
    runs: sameAs(
      ['app/goals/[goalId]/link-actions.ts#linkAimAction', 'lib/goals/links-store.ts#linkTarget'],
      ['app/goals/[goalId]/link-actions.ts#linkJobSearchAction', 'lib/goals/links-store.ts#linkTarget'],
      ['app/goals/[goalId]/link-actions.ts#linkRowAction', 'lib/goals/links-store.ts#linkTarget'],
      ['app/goals/[goalId]/link-actions.ts#unlinkAction', 'lib/goals/links-store.ts#unlinkTarget'],
    ),
    description:
      "Link one of the person's goals to one of their Learn goals or to their job search, or unlink it, when they ask (change link_aim or unlink_aim, with aim; link_job_search or unlink_job_search). Or list one of their readings, calendar events, saved products or contacts on the goal, or take it off (link_row or unlink_row, with kind and target, and list for the list's name, such as \"Pantries to compare\"; a row already listed moves to the list named). Give step_ref to list the row on one of the goal's steps instead: a saved product listed on a step closes that step when it is bought. Name the goal by the goals.items ref a lookup returned, the Learn goal by its name as they have it, and the row by its ref or its name. The goal points at the row rather than copying it, and nothing in Learn, Todo, Shopping or the job search is changed.",
    input_schema: {
      type: 'object',
      properties: {
        change: { type: 'string', enum: [...LINK_CHANGES], description: 'What to link or unlink.' },
        goal_ref: { type: 'string', description: 'The goals.items ref a lookup returned for the goal.' },
        aim: { type: 'string', description: 'For link_aim and unlink_aim: the Learn goal, by its name or learn.aims ref.' },
        kind: {
          type: 'string',
          enum: [...LISTED_KINDS],
          description: 'For link_row and unlink_row: a reading (learn.readings), event (todo.events), saved_item (saved_items) or contact (job_search.contacts).',
        },
        target: { type: 'string', description: 'For link_row and unlink_row: the row, by the ref a lookup returned or its name.' },
        step_ref: {
          type: 'string',
          description: "For link_row and unlink_row: a step under the goal, by its goals.items ref, to list the row on that step rather than on the goal. A saved product listed on a step closes the step when it is bought.",
        },
        list: {
          type: 'string',
          description: `For link_row: the list on the goal it goes in. Leave out for the kind's own list (${LISTED_KINDS.map((k) => `"${DEFAULT_LIST_NAMES[k]}"`).join(', ')}), or to keep the list it is in.`,
        },
      },
      required: ['change', 'goal_ref'],
      additionalProperties: false,
    },
    run: changeGoalLink,
  },
  {
    name: 'change_goal_form',
    runs: sameAs(
      ['app/goals/[goalId]/document-actions.ts#saveDocumentKindAction', 'lib/goals/document-kinds-store.ts#editKind'],
      ['app/goals/[goalId]/document-actions.ts#forgetDocumentKindAction', 'lib/goals/document-kinds-store.ts#forgetKind'],
      ['app/goals/[goalId]/information-actions.ts#archiveRecordAction', 'lib/goals/collections-store.ts#archiveRecord'],
      ['app/goals/[goalId]/information-actions.ts#saveQuestionsAction', 'lib/goals/steps-store.ts#setStepQuestions'],
    ),
    description:
      "Change the form on one of the person's steps that gathers information, or a collection serving a goal, when they ask: set the questions it asks (change set_questions, with questions as the whole list; a wording kept keeps its answer, and an empty list clears them), add a row with the values they give (add_record, with values by field label) or change one (edit_record, with record and the values that change), on a step's form by step_ref or on a list serving a goal by goal_ref and collection (its name, such as the spaces list), archive one of its rows or bring an archived one back (archive_record, restore_record, with record as words from the row such as its name), change a kind of document it has learned to read (edit_document_kind, with document_kind and any of name, recognise, senders and skipped), or forget one so the next is read as new (forget_document_kind). Name the step by the goals.items ref a lookup returned. A row or kind that does not match is refused with the ones there are.",
    input_schema: {
      type: 'object',
      properties: {
        change: { type: 'string', enum: [...FORM_CHANGES], description: 'What to change on the form.' },
        step_ref: { type: 'string', description: 'The goals.items ref a lookup returned for the step.' },
        goal_ref: { type: 'string', description: 'For add_record and edit_record on a collection serving a goal, in place of step_ref: the goals.items ref of the goal.' },
        collection: { type: 'string', description: 'With goal_ref: the collection by its name, when more than one serves the goal.' },
        values: {
          type: 'object',
          additionalProperties: { type: ['string', 'number', 'boolean', 'null'] },
          description: 'For add_record and edit_record: the values by field label (or key), such as {"Width": 31}.',
        },
        questions: { type: 'array', items: { type: 'string' }, description: 'For set_questions: every question the step should ask, in order.' },
        record: { type: 'string', description: 'For edit_record, archive_record and restore_record: words from the row, or its goals.records ref.' },
        document_kind: { type: 'string', description: 'For edit_document_kind and forget_document_kind: the kind by its name.' },
        name: { type: 'string', description: 'For edit_document_kind: its new name.' },
        recognise: { type: 'string', description: 'For edit_document_kind: how to tell a document of this kind.' },
        senders: { type: 'array', items: { type: 'string' }, description: 'For edit_document_kind: who sends it, each a name or address.' },
        skipped: { type: 'array', items: { type: 'string' }, description: 'For edit_document_kind: the labels on it that are left out.' },
      },
      required: ['change'],
      additionalProperties: false,
    },
    run: changeGoalForm,
  },
  {
    name: 'change_goals_inbox',
    runs: sameAs(
      ['app/goals/suggestion-actions.ts#recordAttendedAction', 'lib/goals/suggestions-store.ts#recordAttended'],
      ['app/goals/inbox/actions.ts#snoozeInboxRowAction', 'lib/core/snooze-days.ts#snoozeDay'],
      ['app/goals/inbox/actions.ts#unsnoozeInboxRowAction', 'lib/core/inbox-snooze-store.ts#unsnoozeRow'],
    ),
    description:
      "Change a row on the person's Goals Inbox, when they ask: snooze a goal or step there until a day (change snooze, with row_ref and until) or bring a snoozed one back (unsnooze, with row_ref), or record whether they went to an event they said they were going to (went, did_not_go, with event in their words). Name the goal or step by the goals.items ref a lookup returned. An event that does not match is refused with the ones waiting for an answer. Putting a step off on Goals itself, so it leaves Up next, is change_goal_step set_aside.",
    input_schema: {
      type: 'object',
      properties: {
        change: { type: 'string', enum: [...INBOX_CHANGES], description: 'What to do.' },
        row_ref: { type: 'string', description: 'For snooze and unsnooze: the goals.items ref a lookup returned for the goal or step.' },
        until: { type: 'string', description: 'For snooze: tomorrow, weekend, next_week, next_month, or a day after today as YYYY-MM-DD.' },
        event: { type: 'string', description: 'For went and did_not_go: the event, in words from its name, or its goals.suggestions ref.' },
      },
      required: ['change'],
      additionalProperties: false,
    },
    run: changeGoalsInbox,
  },
  CHANGE_GOAL_LIST,
];

/** Runs one Goals write. Never throws: a refusal or a failure is the sentence the model reads. */
export async function runGoalsWrite(
  write: GoalsWrite,
  env: GoalsWriteEnv,
  input: unknown,
): Promise<GoalsMade | { ok: false; error: string }> {
  const args = input && typeof input === 'object' ? (input as Args) : {};
  try {
    return await write.run(env, args);
  } catch (error) {
    if (error instanceof GoalsRefused) return { ok: false, error: error.message };
    console.error(`goals write ${write.name} failed`, error);
    return { ok: false, error: 'That change could not be made. Tell them nothing was changed.' };
  }
}

const ASK_NOTE =
  'It is done: it shows under your answer with an Undo. Say in your answer what you did, and cite the row this returned.';

/** The Goals writes as Ask's write tools, run on the person's own clients. */
export const GOALS_WRITE_TOOLS: readonly DashWriteTool<DashWriteResult>[] = GOALS_WRITES.map((write) => ({
  name: write.name,
  kind: 'write' as const,
  runs: write.runs,
  definition: { name: write.name, description: `${write.description} ${ASK_NOTE}`, input_schema: write.input_schema },
  apply: async (ctx: DashWriteContext, input: unknown): Promise<DashWriteResult> => {
    if (!ctx.enabledModules.includes('goals')) {
      return { ok: false, error: 'The Goals workspace is switched off, so nothing can be changed there.' };
    }
    const env: GoalsWriteEnv = {
      userId: ctx.userId,
      goals: await ctx.db('goals'),
      write: ctx.goals,
      core: await ctx.db('core'),
      today: ctx.today,
      timezone: ctx.timezone,
    };
    const made = await runGoalsWrite(write, env, input);
    if ('ok' in made) return made;
    return { ok: true, ...made, input: made.input as unknown as Record<string, unknown> };
  },
}));
