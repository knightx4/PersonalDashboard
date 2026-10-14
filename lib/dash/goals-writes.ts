import type Anthropic from '@anthropic-ai/sdk';
import { isUuid, type AskRow, type SchemaClient } from '@/lib/ask/db';
import type { GoalsChangeInput, GoalsChangeKind } from '@/lib/ask/goals-changes';
import { toRef } from '@/lib/core/refs';
import type { GoalsActor, GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { DUE_PRECISIONS } from '@/lib/goals/due-precision';
import {
  archiveArea,
  insertArea,
  moveGoal,
  renameArea,
  setAreaNote,
  setGoalArchived,
  settleGoal,
  unarchiveArea,
  updateGoal,
} from '@/lib/goals/store';
import { parseAreaName, parseAreaNote, parseGoalFields, reorder } from '@/lib/goals/tree';
import type { DashWriteContext, DashWriteResult, DashWriteTool } from './registry';

/**
 * The Goals changes an agent makes when asked, beyond the four Ask already
 * had (plan #1894.7.1, feature #1894):
 *
 *   change_goal_area  an area added, renamed, given a note, moved up or down,
 *                     archived or restored.
 *   change_goal       a goal reworded, given a due date or moved to another
 *                     area, moved up or down, archived or restored, closed,
 *                     parked or reopened.
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
};

/** A Goals change as made, before a surface keeps it. */
export type GoalsMade = {
  kind: GoalsChangeKind;
  input: GoalsChangeInput;
  subjectRef: string;
  op: 'insert' | 'update';
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  /** `{ none }` when the change cannot be put back from its one row. */
  undo: Record<string, unknown> | null;
  summary: string;
  row: AskRow;
};

export type GoalsWrite = {
  name: GoalsChangeKind;
  /** Without the line each surface adds on where the change shows. */
  description: string;
  input_schema: Anthropic.Tool['input_schema'];
  run: (env: GoalsWriteEnv, args: Args) => Promise<GoalsMade>;
};

/** A refusal the model reads and says in words. */
export class GoalsRefused extends Error {}

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
  words: { verb: string; rest: string; summary: string; undo: string | null },
): Promise<GoalsMade> {
  const id = before.id as string;
  const after = await ownRow(env.goals, 'items', id, env.userId);
  return {
    kind: 'change_goal',
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
// The tools
// ---------------------------------------------------------------------------

export const GOALS_WRITES: readonly GoalsWrite[] = [
  {
    name: 'change_goal_area',
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
  definition: { name: write.name, description: `${write.description} ${ASK_NOTE}`, input_schema: write.input_schema },
  apply: async (ctx: DashWriteContext, input: unknown): Promise<DashWriteResult> => {
    if (!ctx.enabledModules.includes('goals')) {
      return { ok: false, error: 'The Goals workspace is switched off, so nothing can be changed there.' };
    }
    const env: GoalsWriteEnv = { userId: ctx.userId, goals: await ctx.db('goals'), write: ctx.goals };
    const made = await runGoalsWrite(write, env, input);
    if ('ok' in made) return made;
    return { ok: true, ...made, input: made.input as unknown as Record<string, unknown> };
  },
}));
