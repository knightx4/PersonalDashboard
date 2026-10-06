import { beforeEach, describe, expect, it } from 'vitest';
import type { AskContext } from '@/lib/ask/db';
import { undoChange, type ChangeDeps } from '@/lib/ask/changes';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { insertMadeChange, type MadeDashChange } from '@/lib/talk/changes';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { fakeSchemaDb, type FakeTables } from '../../tests/stubs/fake-schema-db';
import type { DashWriteContext, DashWriteResult } from './registry';
import { WRITE_TOOLS } from './writes';

/**
 * The changes Ask Dash makes straight away (plan #1440): each of the four
 * requests the step names (a new goal, a rescheduled todo, a closed todo or
 * step, a note on a role) changes the row it names, reports the row to link
 * to, and is undone from the record it leaves. One in-memory database stands
 * in for the person's clients.
 */

const ME = '00000000-0000-4000-8000-0000000000cc';
const AREA = '00000000-0000-4000-8000-000000000a01';
const GOAL = '00000000-0000-4000-8000-000000000a02';
const STEP = '00000000-0000-4000-8000-000000000a03';
const TODO = '00000000-0000-4000-8000-000000000b01';
const ITEM = '00000000-0000-4000-8000-000000000b02';
const ROLE = '00000000-0000-4000-8000-000000000c01';
const APPLICATION = '00000000-0000-4000-8000-000000000c02';

let tables: FakeTables;
let seen: Set<string>;

function context(enabled: AskContext['enabledModules'] = ['todo', 'goals', 'jobs', 'shopping']): DashWriteContext {
  const client = fakeSchemaDb(tables);
  return {
    userId: ME,
    today: '2026-10-03',
    timezone: 'UTC',
    enabledModules: enabled,
    db: async (schema) => client(schema),
    searchSources: [],
    seen: (table, ref) => seen.has(`${table}:${ref}`),
    goals: async () => client('goals') as unknown as GoalsSupabaseClient,
    createTask: async (userId, input) => {
      const id = '00000000-0000-4000-8000-000000000b09';
      tables['todo.tasks'].push({ id, user_id: userId, title: input.title, status: 'open', due_on: input.dueOn, parent_id: null });
      return { id, error: null };
    },
  };
}

function apply(name: string, input: unknown, ctx = context()): Promise<DashWriteResult> {
  const tool = WRITE_TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`no tool ${name}`);
  return tool.apply(ctx, input);
}

function ok(result: DashWriteResult): Extract<DashWriteResult, { ok: true }> {
  if (!result.ok) throw new Error(result.error);
  return result;
}

/** Keeps a write as Ask does, then undoes it through Ask's Undo. */
async function keepAndUndo(result: Extract<DashWriteResult, { ok: true }>) {
  const client = fakeSchemaDb(tables);
  const core = client('core') as unknown as CoreSupabaseClient;
  const kept = await insertMadeChange(core, ME, 'conv-1', { ...result, undo: result.undo ?? null } as unknown as MadeDashChange);
  const deps: ChangeDeps = {
    userId: ME,
    timezone: 'UTC',
    today: '2026-10-03',
    enabledModules: ['todo', 'goals', 'jobs', 'shopping'],
    core: client('core'),
    db: async (schema) => client(schema),
    goals: async () => client('goals') as unknown as GoalsSupabaseClient,
    createTask: async () => ({ id: null, error: 'unused' }),
    now: () => '2026-10-03T12:00:00Z',
  };
  return { kept, undone: await undoChange(deps, kept.id) };
}

beforeEach(() => {
  seen = new Set();
  tables = {
    'core.dash_actions': [],
    'todo.tasks': [
      { id: TODO, user_id: ME, title: 'Book the dentist', status: 'open', due_on: '2026-10-05', due_at: null, parent_id: null },
      { id: ITEM, user_id: ME, title: 'Find the number', status: 'open', due_on: null, due_at: null, parent_id: TODO },
    ],
    'goals.areas': [{ id: AREA, user_id: ME, name: 'Health', position: 1, archived_at: null }],
    'goals.items': [
      { id: GOAL, user_id: ME, level: 'goal', area_id: AREA, parent_id: null, title: 'Run a half marathon', status: 'open', archived_at: null, position: 1 },
      { id: STEP, user_id: ME, level: 'step', parent_id: GOAL, title: 'Buy running shoes', status: 'open', archived_at: null, position: 1 },
    ],
    'job_search.roles': [{ id: ROLE, user_id: ME, title: 'Product designer' }],
    'job_search.applications': [{ id: APPLICATION, user_id: ME, role_id: ROLE }],
    'core.conversation_turns': [],
  };
});

describe('change_todo', () => {
  it('moves a todo it has seen to another day, links to it, and Undo puts the day back', async () => {
    seen.add(`todo.tasks:${TODO}`);
    const result = ok(await apply('change_todo', { todo_ref: TODO, due_on: '2026-10-09' }));
    expect(tables['todo.tasks'][0]).toMatchObject({ due_on: '2026-10-09', due_at: null, title: 'Book the dentist' });
    expect(result).toMatchObject({
      kind: 'change_todo',
      op: 'update',
      subjectRef: `todo.tasks:${TODO}`,
      input: { id: TODO, title: 'Book the dentist', renamedFrom: null, moved: true, dueOn: '2026-10-09' },
      row: { table: 'todo.tasks', ref: TODO, href: `/todo/all?status=all&focus=${TODO}` },
    });
    expect(result.before?.due_on).toBe('2026-10-05');
    expect(result.summary).toBe('Dash moved the todo "Book the dentist" to 2026-10-09.');

    const { kept, undone } = await keepAndUndo(result);
    expect(kept).toMatchObject({ status: 'done', kind: 'change_todo', conversationId: 'conv-1' });
    expect(undone).toMatchObject({ ok: true, change: { status: 'undone' } });
    expect(tables['todo.tasks'][0].due_on).toBe('2026-10-05');
  });

  it('refuses a todo no lookup returned, and changes nothing', async () => {
    const result = await apply('change_todo', { todo_ref: TODO, due_on: '2026-10-09' });
    expect(result).toMatchObject({ ok: false });
    expect(!result.ok && result.error).toContain('No lookup in this conversation returned todo.tasks');
    expect(tables['todo.tasks'][0].due_on).toBe('2026-10-05');
  });
});

describe('close_todo', () => {
  it('ticks off the todo and the items on its list, and Undo opens both again', async () => {
    seen.add(`todo.tasks:${TODO}`);
    const result = ok(await apply('close_todo', { todo_ref: TODO }));
    expect(tables['todo.tasks'].map((t) => t.status)).toEqual(['done', 'done']);
    expect(result).toMatchObject({ kind: 'close_todo', undo: { items: [ITEM] }, input: { items: 1 } });

    const { undone } = await keepAndUndo(result);
    expect(undone.ok).toBe(true);
    expect(tables['todo.tasks'].map((t) => t.status)).toEqual(['open', 'open']);
  });
});

describe('add_goal', () => {
  it('adds a goal under the area named, approved as theirs, and Undo removes it', async () => {
    const result = ok(await apply('add_goal', { area: 'health', title: 'Sleep eight hours' }));
    const goal = tables['goals.items'].find((row) => row.title === 'Sleep eight hours');
    expect(goal).toMatchObject({ level: 'goal', area_id: AREA, user_id: ME });
    expect(result).toMatchObject({
      kind: 'add_goal',
      op: 'insert',
      input: { areaId: AREA, areaName: 'Health', title: 'Sleep eight hours' },
      row: { table: 'goals.items', ref: goal!.id, href: `/goals/${goal!.id}` },
    });

    const { undone } = await keepAndUndo(result);
    expect(undone.ok).toBe(true);
    expect(tables['goals.items'].some((row) => row.title === 'Sleep eight hours')).toBe(false);
  });

  it('names their areas when the one asked for is not there', async () => {
    const result = await apply('add_goal', { area: 'Money', title: 'Save for a car' });
    expect(!result.ok && result.error).toContain('Their areas are "Health"');
    expect(!result.ok && result.error).toContain('new_area true');
  });

  it('makes a new area when asked to, and puts the goal under it', async () => {
    const result = ok(await apply('add_goal', { area: 'Music', new_area: true, title: 'Publish a song on Spotify' }));
    const area = tables['goals.areas'].find((row) => row.name === 'Music');
    expect(area).toMatchObject({ user_id: ME });
    const goal = tables['goals.items'].find((row) => row.title === 'Publish a song on Spotify');
    expect(goal).toMatchObject({ level: 'goal', area_id: area!.id });
    expect(result).toMatchObject({ input: { areaName: 'Music', areaMade: true } });
  });

  it('uses the area they have when new_area names one that exists', async () => {
    const result = ok(await apply('add_goal', { area: 'Health', new_area: true, title: 'Sleep eight hours' }));
    expect(tables['goals.areas']).toHaveLength(1);
    expect(result).toMatchObject({ input: { areaId: AREA, areaMade: false } });
  });
});

describe('close_goal_step', () => {
  it('marks a step done under its goal, linking to the step on the goal', async () => {
    seen.add(`goals.items:${STEP}`);
    const result = ok(await apply('close_goal_step', { step_ref: STEP }));
    expect(tables['goals.items'][1].status).toBe('done');
    expect(result).toMatchObject({
      kind: 'close_goal_step',
      input: { id: STEP, goalId: GOAL, goalTitle: 'Run a half marathon' },
      row: { href: `/goals/${GOAL}#step-${STEP}` },
    });

    const { undone } = await keepAndUndo(result);
    expect(undone.ok).toBe(true);
    expect(tables['goals.items'][1].status).toBe('open');
  });

  it('will not close a goal', async () => {
    seen.add(`goals.items:${GOAL}`);
    const result = await apply('close_goal_step', { step_ref: GOAL });
    expect(!result.ok && result.error).toContain('That is a goal, not a step');
    expect(tables['goals.items'][0].status).toBe('open');
  });
});

describe('add_role_note', () => {
  it('adds a note to the role an application names, and links to the role', async () => {
    seen.add(`job_search.applications:${APPLICATION}`);
    const result = ok(await apply('add_role_note', { role_ref: APPLICATION, body: 'Recruiter is Sam.' }));
    // A turn in the role's thread, in the shared store (plan #1470).
    expect(tables['core.conversation_turns']).toEqual([
      expect.objectContaining({ ref: `job_search.roles:${ROLE}`, body: 'Recruiter is Sam.', author: 'me', user_id: ME }),
    ]);
    expect(result).toMatchObject({
      kind: 'add_role_note',
      op: 'insert',
      input: { roleId: ROLE, roleTitle: 'Product designer' },
      row: { table: 'job_search.roles', ref: ROLE, href: `/jobs/roles/${ROLE}` },
    });

    const { undone } = await keepAndUndo(result);
    expect(undone.ok).toBe(true);
    expect(tables['core.conversation_turns']).toEqual([]);
  });

  it('refuses while Jobs is switched off', async () => {
    seen.add(`job_search.roles:${ROLE}`);
    const result = await apply('add_role_note', { role_ref: ROLE, body: 'x' }, context(['todo']));
    expect(!result.ok && result.error).toContain('Jobs workspace is switched off');
  });
});

describe('add_todo', () => {
  it('adds the todo as Confirm did, in the shape Ask has always kept', async () => {
    const result = ok(await apply('add_todo', { title: 'Call the bank', due_on: '2026-10-06' }));
    expect(result).toMatchObject({
      kind: 'add_todo',
      op: 'insert',
      input: { title: 'Call the bank', dueOn: '2026-10-06', body: null, dueTime: null, pinned: false },
      row: { table: 'todo.tasks', title: 'Call the bank' },
    });
    expect(tables['todo.tasks'].some((t) => t.title === 'Call the bank')).toBe(true);
  });
});

describe('the card under the answer', () => {
  it('says what each new kind did, and links to the row', async () => {
    const { changeHref, changeSentence } = await import('@/lib/ask/change-view');
    const card = (kind: string, input: Record<string, unknown>, writtenRef: string | null = null) =>
      ({ kind, input, writtenRef, status: 'done' }) as unknown as Parameters<typeof changeSentence>[0];

    const moved = card('change_todo', { id: TODO, title: 'Book the dentist', renamedFrom: null, moved: true, dueOn: '2026-10-09', dueTime: null });
    expect(changeSentence(moved, true, '2026-10-03')).toBe('Moved the todo Book the dentist to Friday 9 October');
    expect(changeHref(moved)).toBe(`/todo/all?status=all&focus=${TODO}`);

    const goal = card('add_goal', { areaId: AREA, areaName: 'Health', title: 'Sleep eight hours', dueOn: null }, GOAL);
    expect(changeSentence(goal, true)).toBe('Added the goal Sleep eight hours under Health');
    expect(changeHref(goal)).toBe(`/goals/${GOAL}`);

    const step = card('close_goal_step', { id: STEP, title: 'Buy running shoes', goalId: GOAL, goalTitle: 'Run a half marathon' });
    expect(changeSentence(step, true)).toBe('Closed the step Buy running shoes under Run a half marathon');

    const ticked = card('close_todo', { id: TODO, title: 'Book the dentist', items: 2 });
    expect(changeSentence(ticked, true)).toBe('Ticked off Book the dentist, with the 2 items on its list');

    const note = card('add_role_note', { roleId: ROLE, roleTitle: 'Product designer', body: 'Recruiter is Sam.\nMore.' });
    expect(changeSentence(note, true)).toBe('Added a note to Product designer: Recruiter is Sam.');
    expect(changeHref(note)).toBe(`/jobs/roles/${ROLE}`);
  });
});
