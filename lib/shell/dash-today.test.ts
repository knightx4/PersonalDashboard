import { describe, expect, it, vi } from 'vitest';
import type { ChangeOutcome } from '@/lib/ask/changes';
import { fakeDashDeps, type FakeTables } from '../../tests/stubs/fake-schema-db';
import { dayBounds, loadDashToday, undoDashTodayWith } from './dash-today';

/**
 * Home's "What Dash did today" (plan #1461): today's changes from
 * core.dash_actions in the person's zone, grouped by workspace, and the undo
 * its rows press, against an in-memory database.
 */

const ME = '00000000-0000-4000-8000-00000000000a';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ZONE = 'America/New_York';
const TODAY = '2026-10-03';

type Row = Record<string, unknown>;

const TASK = id(1);
const STEP = id(2);
const TASK_BEFORE: Row = { id: TASK, user_id: ME, title: 'Call the bank', due_on: '2026-10-02', status: 'open' };
const TASK_AFTER: Row = { ...TASK_BEFORE, due_on: '2026-10-09' };
const STEP_BEFORE: Row = { id: STEP, user_id: ME, number: 1460, title: 'Give routines one call', status: 'in_progress' };
const STEP_AFTER: Row = { ...STEP_BEFORE, status: 'done' };

function action(n: number, over: Row = {}): Row {
  return {
    id: id(600 + n),
    user_id: ME,
    conversation_id: null,
    turn_id: null,
    input: null,
    undo: null,
    surface: 'routine',
    kind: 'reschedule_todo',
    status: 'done',
    subject_ref: `todo.tasks:${TASK}`,
    op: 'update',
    before_values: TASK_BEFORE,
    after_values: TASK_AFTER,
    summary: 'Dash moved Call the bank to 9 October.',
    created_at: '2026-10-03T14:00:00Z',
    done_at: '2026-10-03T14:00:00Z',
    declined_at: null,
    undone_at: null,
    ...over,
  };
}

const ASK = action(5, {
  surface: 'ask',
  kind: 'add_todo',
  conversation_id: id(900),
  input: { title: 'Buy stamps', body: null, dueOn: null, dueTime: null, pinned: false },
  subject_ref: `todo.tasks:${id(3)}`,
  op: 'insert',
  before_values: null,
  after_values: { id: id(3), title: 'Buy stamps' },
  summary: null,
  done_at: '2026-10-03T15:00:00Z',
});

const CLOSE = action(6, {
  kind: 'close_step',
  subject_ref: `public.plan_items:${STEP}`,
  before_values: STEP_BEFORE,
  after_values: STEP_AFTER,
  summary: 'Dash closed step #1460, "Give routines one call".',
  done_at: '2026-10-03T16:00:00Z',
});

function setup(rows: Row[]) {
  const tables: FakeTables = {
    'core.dash_actions': rows,
    'todo.tasks': [{ ...TASK_AFTER }, { id: id(3), user_id: ME, title: 'Buy stamps' }],
    'public.plan_items': [{ ...STEP_AFTER }],
  };
  const deps = fakeDashDeps(tables, ME, '2026-10-03T18:00:00Z');
  return { tables, deps };
}

function load(deps: ReturnType<typeof setup>['deps'], shown?: (w: string) => boolean) {
  return loadDashToday(deps.core, { userId: ME, today: TODAY, timezone: ZONE, shown });
}

describe('dayBounds', () => {
  it('runs from midnight to midnight in the person’s zone', () => {
    expect(dayBounds(TODAY, ZONE)).toEqual({
      start: '2026-10-03T04:00:00.000Z',
      end: '2026-10-04T04:00:00.000Z',
    });
  });
});

describe('loadDashToday', () => {
  it('groups today’s changes by workspace, newest group and newest row first', async () => {
    const { deps } = setup([action(1), ASK, CLOSE]);
    const groups = await load(deps);

    expect(groups.map((group) => [group.workspace, group.label])).toEqual([
      ['dev', 'Dev'],
      ['todo', 'Todo'],
    ]);
    expect(groups[0].entries.map((entry) => entry.sentence)).toEqual([
      'Dash closed step #1460, "Give routines one call".',
    ]);
    // A routine's own sentence is shown as written; an Ask change is worded
    // the way the Ask page words it.
    expect(groups[1].entries.map((entry) => entry.sentence)).toEqual([
      'Added the todo Buy stamps.',
      'Dash moved Call the bank to 9 October.',
    ]);
    expect(groups[0].entries[0].href).toBe(`/open/public.plan_items%3A${STEP}`);
  });

  it('leaves out yesterday in the person’s zone, tomorrow, and what wrote nothing', async () => {
    const { deps } = setup([
      // 10pm on 2 October in New York.
      action(1, { done_at: '2026-10-03T02:00:00Z' }),
      // Just past midnight on 4 October there.
      action(2, { done_at: '2026-10-04T04:30:00Z' }),
      action(3, { status: 'proposed', done_at: null }),
      action(4, { status: 'declined', done_at: null, declined_at: '2026-10-03T14:00:00Z' }),
      action(7, { user_id: id(77) }),
    ]);
    expect(await load(deps)).toEqual([]);
  });

  it('keeps an undone change, said as undone and with nothing to open', async () => {
    const { deps } = setup([action(1, { status: 'undone', undone_at: '2026-10-03T15:00:00Z' })]);
    const [group] = await load(deps);
    expect(group.entries).toMatchObject([{ status: 'undone', href: null }]);
  });

  it('leaves out a workspace switched off', async () => {
    const { deps } = setup([action(1), CLOSE]);
    const groups = await load(deps, (workspace) => workspace !== 'dev');
    expect(groups.map((group) => group.workspace)).toEqual(['todo']);
  });

  it('puts a change to a table no workspace owns under the app as a whole', async () => {
    const { deps } = setup([action(1, { subject_ref: `core.watches:${id(9)}` })]);
    const [group] = await load(deps);
    expect(group).toMatchObject({ workspace: null, label: 'Across the app' });
  });
});

describe('undoDashTodayWith', () => {
  const askUndo = vi.fn<(id: string) => Promise<ChangeOutcome>>();

  it('puts the row back and marks the change undone, and Home then lists it so', async () => {
    const { tables, deps } = setup([CLOSE]);
    const out = await undoDashTodayWith(deps, id(606), askUndo);

    expect(out).toEqual({ ok: true, paths: [] });
    expect(tables['public.plan_items'][0]).toMatchObject({ status: 'in_progress' });
    expect(askUndo).not.toHaveBeenCalled();
    const [group] = await load(deps);
    expect(group.entries[0]).toMatchObject({ status: 'undone' });
  });

  it('refuses with the sentence the person reads once the row has moved on', async () => {
    const { tables, deps } = setup([CLOSE]);
    tables['public.plan_items'][0].title = 'Renamed since';
    const out = await undoDashTodayWith(deps, id(606), askUndo);

    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/\w/);
    expect(tables['public.plan_items'][0]).toMatchObject({ status: 'done' });
  });

  it('hands an Ask Dash change to its own undo', async () => {
    const { deps } = setup([ASK]);
    askUndo.mockResolvedValueOnce({ ok: false, error: 'Dash can only undo this while it is still open.', change: null });
    const out = await undoDashTodayWith(deps, id(605), askUndo);

    expect(askUndo).toHaveBeenCalledWith(id(605));
    expect(out).toEqual({ ok: false, error: 'Dash can only undo this while it is still open.' });
  });
});
