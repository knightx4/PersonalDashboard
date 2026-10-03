import { describe, expect, it } from 'vitest';
import type { AskSchema, SchemaClient } from '@/lib/ask/db';
import { planUndo, sameValue, undoDashAction, type DashAction, type DashActionDeps } from './dash-actions';

/**
 * Undoing any of Dash's changes by one rule (plan #1458), against an
 * in-memory database standing in for the person's clients.
 */

const ME = '00000000-0000-4000-8000-00000000000a';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TASK = id(1);
const ACTION = id(600);

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

function fakeDb(tables: Tables) {
  return function client(schema: string): SchemaClient {
    return {
      from(table: string) {
        const rows = (tables[`${schema}.${table}`] ??= []);
        const filters: ((row: Row) => boolean)[] = [];
        let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
        let payload: Row = {};
        let limit = Infinity;
        let single = false;

        function run() {
          let out: Row[];
          if (op === 'insert') {
            if (rows.some((r) => r.id === payload.id)) return { data: null, error: { message: 'duplicate key' } };
            rows.push({ ...payload });
            out = [payload];
          } else {
            out = rows.filter((row) => filters.every((f) => f(row)));
            if (op === 'update') for (const row of out) Object.assign(row, payload);
            if (op === 'delete') for (const row of out) rows.splice(rows.indexOf(row), 1);
          }
          out = out.slice(0, limit).map((row) => ({ ...row }));
          if (single) return { data: out[0] ?? null, error: null };
          return { data: out, error: null };
        }

        const query = {
          select: () => query,
          insert: (value: Row) => ((op = 'insert'), (payload = value), query),
          update: (value: Row) => ((op = 'update'), (payload = value), query),
          delete: () => ((op = 'delete'), query),
          eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), query),
          neq: (c: string, v: unknown) => (filters.push((r) => r[c] !== v), query),
          gt: (c: string, v: string) => (filters.push((r) => String(r[c]) > v), query),
          limit: (n: number) => ((limit = n), query),
          maybeSingle: () => ((single = true), query),
          then: (resolve: (value: unknown) => void) => resolve(run()),
        };
        return query;
      },
    } as unknown as SchemaClient;
  };
}

const TASK_BEFORE: Row = { id: TASK, user_id: ME, title: 'Call the bank', due_on: '2026-10-02', status: 'open', updated_at: '2026-10-01T09:00:00Z' };
const TASK_AFTER: Row = { ...TASK_BEFORE, due_on: '2026-10-09', updated_at: '2026-10-03T08:00:00Z' };

function action(over: Row = {}): Row {
  return {
    id: ACTION,
    user_id: ME,
    surface: 'routine',
    kind: 'reschedule_todo',
    status: 'done',
    subject_ref: `todo.tasks:${TASK}`,
    op: 'update',
    before_values: TASK_BEFORE,
    after_values: TASK_AFTER,
    summary: 'Moved Call the bank to 9 October.',
    created_at: '2026-10-03T08:00:00Z',
    done_at: '2026-10-03T08:00:00Z',
    undone_at: null,
    ...over,
  };
}

function setup(opts: { task?: Row | null; action?: Row; more?: Row[] } = {}) {
  const tables: Tables = {
    'core.dash_actions': [action(opts.action), ...(opts.more ?? [])],
    'todo.tasks': opts.task === null ? [] : [{ ...(opts.task ?? TASK_AFTER) }],
  };
  const client = fakeDb(tables);
  const deps: DashActionDeps = {
    userId: ME,
    core: client('core'),
    db: async (schema: AskSchema) => client(schema),
    now: () => '2026-10-03T12:00:00Z',
  };
  return { tables, deps };
}

describe('undoDashAction', () => {
  it('puts back what Dash changed while the row still holds what Dash left', async () => {
    const { tables, deps } = setup();
    const out = await undoDashAction(deps, ACTION);
    expect(out).toMatchObject({ ok: true, action: { status: 'undone', undoneAt: '2026-10-03T12:00:00Z' } });
    expect(tables['todo.tasks'][0]).toMatchObject({ due_on: '2026-10-02', title: 'Call the bank' });
    expect(tables['core.dash_actions'][0].status).toBe('undone');
  });

  it('refuses once the row has changed after Dash wrote it, and leaves it alone', async () => {
    const edited = { ...TASK_AFTER, title: 'Call the bank about the loan' };
    const { tables, deps } = setup({ task: edited });
    const out = await undoDashAction(deps, ACTION);
    expect(out).toMatchObject({
      ok: false,
      error: 'It has changed since Dash wrote it, so undoing would lose the later change.',
    });
    expect(tables['todo.tasks'][0]).toEqual(edited);
    expect(tables['core.dash_actions'][0].status).toBe('done');
  });

  it('deletes a row Dash added', async () => {
    const { tables, deps } = setup({ action: { op: 'insert', before_values: null } });
    expect((await undoDashAction(deps, ACTION)).ok).toBe(true);
    expect(tables['todo.tasks']).toEqual([]);
  });

  it('puts back a row Dash deleted, as it was', async () => {
    const { tables, deps } = setup({ task: null, action: { op: 'delete', after_values: null } });
    expect((await undoDashAction(deps, ACTION)).ok).toBe(true);
    expect(tables['todo.tasks']).toEqual([TASK_BEFORE]);
  });

  it('refuses when the row Dash added has since been deleted', async () => {
    const { deps } = setup({ task: null, action: { op: 'insert', before_values: null } });
    expect(await undoDashAction(deps, ACTION)).toMatchObject({
      ok: false,
      error: 'It has since been deleted, so there is nothing to undo.',
    });
  });

  it('refuses while a later change of Dash on the same row stands', async () => {
    const later = action({ id: id(601), created_at: '2026-10-03T09:00:00Z' });
    const { tables, deps } = setup({ more: [later] });
    expect(await undoDashAction(deps, ACTION)).toMatchObject({
      ok: false,
      error: 'Dash has changed this again since. Undo that later change first.',
    });
    expect(tables['todo.tasks'][0].due_on).toBe('2026-10-09');
  });

  it('refuses a second press', async () => {
    const { deps } = setup();
    await undoDashAction(deps, ACTION);
    expect(await undoDashAction(deps, ACTION)).toMatchObject({
      ok: false,
      error: 'This change has already been undone.',
    });
  });

  it('leaves Ask Dash changes to their own undo', async () => {
    const { tables, deps } = setup({ action: { surface: 'ask' } });
    expect(await undoDashAction(deps, ACTION)).toMatchObject({
      ok: false,
      error: 'This change was made in Ask Dash, and is undone from there.',
    });
    expect(tables['todo.tasks'][0].due_on).toBe('2026-10-09');
  });
});

describe('planUndo', () => {
  const base = {
    id: ACTION,
    surface: 'routine',
    kind: 'reschedule_todo',
    status: 'done',
    subjectRef: `todo.tasks:${TASK}`,
    op: 'update',
    beforeValues: TASK_BEFORE,
    afterValues: TASK_AFTER,
    summary: null,
    createdAt: '2026-10-03T08:00:00Z',
    doneAt: '2026-10-03T08:00:00Z',
    undoneAt: null,
  } satisfies DashAction;

  it('writes back only the columns Dash changed', () => {
    expect(planUndo(base, { ...TASK_AFTER }, false)).toEqual({ ok: true, plan: { op: 'update', values: { due_on: '2026-10-02' } } });
  });

  it('does not count a moved updated_at as a change', () => {
    expect(planUndo(base, { ...TASK_AFTER, updated_at: '2026-10-03T10:00:00Z' }, false).ok).toBe(true);
  });

  it('refuses an action with no values kept', () => {
    expect(planUndo({ ...base, afterValues: null }, TASK_AFTER, false)).toEqual({
      ok: false,
      reason: 'Dash did not keep what this changed, so it cannot be undone.',
    });
  });
});

describe('sameValue', () => {
  it('reads one instant written two ways as the same', () => {
    expect(sameValue('2026-10-03T08:00:00Z', '2026-10-03T08:00:00+00:00')).toBe(true);
    expect(sameValue('2026-10-03T08:00:00Z', '2026-10-03T08:00:01Z')).toBe(false);
  });

  it('compares objects and lists by what they hold', () => {
    expect(sameValue({ a: [1, { b: null }] }, { a: [1, { b: null }] })).toBe(true);
    expect(sameValue({ a: [1] }, { a: [2] })).toBe(false);
    expect(sameValue(null, undefined)).toBe(true);
  });
});
