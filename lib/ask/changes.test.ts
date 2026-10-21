import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { changeHref, confirmChange, declineChange, undoChange, type ChangeDeps } from './changes';
import type { AskSchema, SchemaClient } from './db';
import type { DashPaidTool } from '@/lib/dash/registry';
import { PAID_NO_UNDO } from '@/lib/dash/paid-input';
import { noUndoReason } from '@/lib/core/dash-actions';

const handOver = vi.hoisted(() => vi.fn());
vi.mock('@/lib/plan/handover', () => ({ handStepToClaude: handOver }));

/**
 * Confirming, declining and undoing Dash's changes (plan #1189), against an
 * in-memory database standing in for the person's clients. It keeps the rows
 * each write leaves, records goals.history the way the trigger does, and
 * moves an item to returned and back as sync_order_state does, so each test
 * reads what a real confirm and undo would leave behind.
 */

const ME = '00000000-0000-4000-8000-00000000000a';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const CONVERSATION = id(500);
const TURN = id(501);
const GOAL = id(1);
const ITEM = id(11);

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

let counter = 1000;

/** One `column[->>key].op.value` part of an `or` filter. */
function orPart(row: Row, part: string): boolean {
  const match = /^(\w+)(?:->>(\w+))?\.(not\.is|is|lt)\.(.+)$/.exec(part);
  if (!match) throw new Error(`The fake cannot read the filter ${part}`);
  const [, column, key, op, value] = match;
  const base = row[column] as Row | null | undefined;
  const cell = key ? (base?.[key] ?? null) : (base ?? null);
  if (op === 'is') return cell === null;
  if (op === 'not.is') return cell !== null;
  return typeof cell === 'string' && cell < value;
}

function fakeDb(tables: Tables) {
  let historyId = 0;

  function recordHistory(row: Row, action: string, newValues: Row | null, headers: Row) {
    tables['goals.history'].push({
      id: ++historyId,
      user_id: row.user_id,
      table_name: 'items',
      row_id: row.id,
      action,
      new_values: newValues,
      actor: headers.actor ?? 'me',
      undoes: headers.undoes ?? null,
    });
  }

  function client(schema: string, headers: Row = {}): SchemaClient {
    return {
      from(table: string) {
        const key = `${schema}.${table}`;
        const rows = (tables[key] ??= []);
        const filters: ((row: Row) => boolean)[] = [];
        let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
        let payload: Row = {};
        let order: { column: string; ascending: boolean } | null = null;
        let limit = Infinity;
        let single: 'one' | 'maybe' | null = null;

        function run(): { data: unknown; error: null | { message: string } } {
          let out: Row[];
          if (op === 'insert') {
            const row: Row = { id: id(++counter), ...payload };
            if (key === 'goals.items') {
              row.status ??= 'open';
              row.archived_at ??= null;
            }
            rows.push(row);
            if (key === 'goals.items') recordHistory(row, 'insert', { ...row }, headers);
            if (key === 'public.returns') {
              const item = tables['public.inventory_items'].find((i) => i.id === row.inventory_item_id);
              if (item) item.status = 'returned';
            }
            out = [row];
          } else {
            out = rows.filter((row) => filters.every((f) => f(row)));
            if (op === 'update') {
              for (const row of out) {
                const diff = Object.fromEntries(Object.entries(payload).filter(([k, v]) => row[k] !== v));
                const archiving = row.archived_at == null && payload.archived_at != null;
                Object.assign(row, payload);
                if (key === 'goals.items' && Object.keys(diff).length > 0) {
                  recordHistory(row, archiving ? 'archive' : 'update', diff, headers);
                }
              }
            }
            if (op === 'delete') {
              for (const row of out) {
                rows.splice(rows.indexOf(row), 1);
                if (key === 'public.returns') {
                  const item = tables['public.inventory_items'].find((i) => i.id === row.inventory_item_id);
                  if (item) item.status = 'owned';
                }
              }
            }
          }
          if (order) {
            const { column, ascending } = order;
            out = [...out].sort((a, b) => ((a[column] as number) - (b[column] as number)) * (ascending ? 1 : -1));
          }
          out = out.slice(0, limit).map((row) => ({ ...row }));
          if (single === 'one') return out[0] ? { data: out[0], error: null } : { data: null, error: { message: 'no rows' } };
          if (single === 'maybe') return { data: out[0] ?? null, error: null };
          return { data: out, error: null };
        }

        const query = {
          select: () => query,
          insert: (value: Row) => ((op = 'insert'), (payload = value), query),
          update: (value: Row) => ((op = 'update'), (payload = value), query),
          delete: () => ((op = 'delete'), query),
          eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), query),
          in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), query),
          is: (c: string, v: null) => (filters.push((r) => (r[c] ?? null) === v), query),
          gt: (c: string, v: number) => (filters.push((r) => (r[c] as number) > v), query),
          // The few PostgREST `or` filters a paid press's claim uses (plan #2228.1).
          or: (expr: string) => (filters.push((r) => expr.split(',').some((part) => orPart(r, part))), query),
          order: (column: string, o?: { ascending?: boolean }) => ((order = { column, ascending: o?.ascending ?? true }), query),
          limit: (n: number) => ((limit = n), query),
          single: () => ((single = 'one'), query),
          maybeSingle: () => ((single = 'maybe'), query),
          then: (resolve: (value: unknown) => void, reject?: (e: unknown) => void) => {
            try {
              resolve(run());
            } catch (e) {
              reject?.(e);
            }
          },
        };
        return query;
      },
    } as unknown as SchemaClient;
  }
  return client;
}

function setup(opts: { status?: string; turnId?: string | null; kind?: string; input?: Row; enabled?: ChangeDeps['enabledModules'] } = {}) {
  const tables: Tables = {
    'core.dash_actions': [],
    'todo.tasks': [],
    'todo.task_links': [],
    'goals.items': [
      { id: GOAL, user_id: ME, level: 'goal', status: 'open', approved_at: '2026-01-01', archived_at: null, position: 1 },
      { id: id(2), user_id: ME, level: 'step', parent_id: GOAL, status: 'open', archived_at: null, position: 1 },
    ],
    'goals.history': [],
    'public.inventory_items': [
      { id: ITEM, user_id: ME, status: 'owned', cost_cents: 4500, order_item_id: id(99) },
    ],
    'public.order_items': [{ id: id(99), order_id: id(98) }],
    'public.returns': [],
    'core.watches': [],
  };
  const client = fakeDb(tables);
  const change: Row = {
    id: id(600),
    user_id: ME,
    conversation_id: CONVERSATION,
    surface: 'ask',
    turn_id: opts.turnId === undefined ? TURN : opts.turnId,
    kind: opts.kind ?? 'add_todo',
    input: opts.input ?? { title: 'Call the bank', body: null, dueOn: '2026-10-02', dueTime: null, pinned: false },
    status: opts.status ?? 'proposed',
    subject_ref: null,
    op: null,
    undo: null,
    created_at: '2026-09-29T10:00:00Z',
    done_at: opts.status === 'done' ? '2026-09-29T10:01:00Z' : null,
    declined_at: opts.status === 'declined' ? '2026-09-29T10:01:00Z' : null,
    undone_at: null,
  };
  tables['core.dash_actions'].push(change);

  // add_todo writes through insertTask (plan #2473.3); a new todo row takes the
  // column defaults the table gives it, and `onTodo` runs after it lands.
  const hooks: { onTodo?: () => void } = {};
  const tasks = tables['todo.tasks'];
  Object.defineProperty(tasks, 'push', {
    enumerable: false,
    value: (...rows: Row[]) => {
      for (const row of rows) Array.prototype.push.call(tasks, Object.assign(row, { status: 'open', due_at: null, snoozed_until: null, parent_id: null, ...row }));
      hooks.onTodo?.();
      return tasks.length;
    },
  });
  const deps: ChangeDeps = {
    userId: ME,
    timezone: 'UTC',
    today: '2026-09-29',
    enabledModules: opts.enabled ?? ['todo', 'goals', 'shopping'],
    core: client('core'),
    db: async (schema: AskSchema) => client(schema),
    goals: async (history) => client('goals', history) as unknown as GoalsSupabaseClient,
    now: () => '2026-09-29T12:00:00Z',
  };
  return { tables, deps, change, hooks };
}

const STEP_INPUT = { parentId: GOAL, goalTitle: 'Find a new job', title: 'Update the CV', kind: 'mine' };
const RETURN_INPUT = { id: ITEM, itemTitle: 'Rain jacket' };

describe('add_todo', () => {
  it('confirming writes one task and marks the change confirmed; undoing deletes it', async () => {
    const { tables, deps, change } = setup();
    const confirmed = await confirmChange(deps, change.id as string);
    expect(confirmed.ok).toBe(true);
    expect(tables['todo.tasks']).toHaveLength(1);
    const task = tables['todo.tasks'][0];
    expect(task).toMatchObject({ title: 'Call the bank', due_on: '2026-10-02' });
    expect(confirmed.ok && confirmed.change).toMatchObject({
      status: 'done',
      subjectRef: `todo.tasks:${task.id}`,
      writtenTable: 'todo.tasks',
      writtenRef: task.id,
      doneAt: '2026-09-29T12:00:00Z',
    });
    expect(tables['core.dash_actions'][0]).toMatchObject({
      surface: 'ask',
      op: 'insert',
      before_values: null,
      after_values: { id: task.id, title: 'Call the bank', due_on: '2026-10-02', status: 'open' },
    });
    expect(confirmed.ok && changeHref(confirmed.change)).toBe(`/todo/all?status=all&focus=${task.id}`);

    const undone = await undoChange(deps, change.id as string);
    expect(undone.ok && undone.change).toMatchObject({ status: 'undone', undoneAt: '2026-09-29T12:00:00Z' });
    expect(tables['todo.tasks']).toHaveLength(0);
  });

  it('refuses the undo once the todo has been ticked off or edited', async () => {
    for (const [edit, reason] of [
      [{ status: 'done' }, 'ticked that todo off'],
      [{ title: 'Call the bank about the loan' }, 'edited that todo'],
      [{ due_on: '2026-10-09' }, 'edited that todo'],
    ] as const) {
      const { tables, deps, change } = setup();
      await confirmChange(deps, change.id as string);
      Object.assign(tables['todo.tasks'][0], edit);
      const undone = await undoChange(deps, change.id as string);
      expect(undone.ok).toBe(false);
      expect(!undone.ok && undone.error).toContain(reason);
      expect(!undone.ok && undone.error).toContain('Dash');
      expect(!undone.ok && undone.error).not.toContain('Claude');
      expect(tables['todo.tasks']).toHaveLength(1);
      expect(tables['core.dash_actions'][0].status).toBe('done');
    }
  });

  it('refuses the undo once an item sits under the todo', async () => {
    const { tables, deps, change } = setup();
    await confirmChange(deps, change.id as string);
    tables['todo.tasks'].push({ id: id(700), user_id: ME, parent_id: tables['todo.tasks'][0].id, status: 'open' });
    const undone = await undoChange(deps, change.id as string);
    expect(!undone.ok && undone.error).toContain('added items under that todo');
  });
});

describe('add_goal_step', () => {
  it('confirming adds one step of yours last under the goal, recorded as Dash\'s; undoing archives it', async () => {
    const { tables, deps, change } = setup({ kind: 'add_goal_step', input: STEP_INPUT });
    const confirmed = await confirmChange(deps, change.id as string);
    expect(confirmed.ok).toBe(true);
    const steps = tables['goals.items'].filter((r) => r.title === 'Update the CV');
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ parent_id: GOAL, kind: 'mine', level: 'step' });
    expect(steps[0].position as number).toBeGreaterThan(1);
    const insert = tables['goals.history'].find((h) => h.row_id === steps[0].id && h.action === 'insert');
    expect(insert?.actor).toBe('claude');
    expect(confirmed.ok && confirmed.change).toMatchObject({ writtenTable: 'goals.items', writtenRef: steps[0].id });
    expect(confirmed.ok && changeHref(confirmed.change)).toBe(`/goals/${GOAL}/s/${steps[0].id}`);

    const undone = await undoChange(deps, change.id as string);
    expect(undone.ok && undone.change.status).toBe('undone');
    expect(steps[0].archived_at).not.toBeNull();
    const archive = tables['goals.history'].find((h) => h.row_id === steps[0].id && h.action === 'archive');
    expect(archive).toMatchObject({ actor: 'me', undoes: insert?.id });
  });

  it('still undoes after the step is only reordered', async () => {
    const { tables, deps, change } = setup({ kind: 'add_goal_step', input: STEP_INPUT });
    await confirmChange(deps, change.id as string);
    const step = tables['goals.items'].find((r) => r.title === 'Update the CV')!;
    await (await deps.goals({})).from('items').update({ position: 0 }).eq('id', step.id);
    expect((await undoChange(deps, change.id as string)).ok).toBe(true);
  });

  it('refuses the undo once the step has been edited, closed or restored from archive', async () => {
    for (const [edit, reason] of [
      [{ title: 'Update the CV and cover letter' }, 'edited or worked on'],
      [{ status: 'done' }, 'worked on since'],
      [{ archived_at: '2026-09-30' }, 'archived'],
    ] as const) {
      const { tables, deps, change } = setup({ kind: 'add_goal_step', input: STEP_INPUT });
      await confirmChange(deps, change.id as string);
      const step = tables['goals.items'].find((r) => r.title === 'Update the CV')!;
      await (await deps.goals({})).from('items').update(edit).eq('id', step.id);
      const undone = await undoChange(deps, change.id as string);
      expect(undone.ok).toBe(false);
      expect(!undone.ok && undone.error).toContain(reason);
      expect(tables['core.dash_actions'][0].status).toBe('done');
    }
  });

  it('refuses to confirm under a goal that has since been closed', async () => {
    const { tables, deps, change } = setup({ kind: 'add_goal_step', input: STEP_INPUT });
    tables['goals.items'][0].status = 'done';
    const confirmed = await confirmChange(deps, change.id as string);
    expect(!confirmed.ok && confirmed.error).toBe('That goal is done now, so a step cannot go under it.');
    expect(tables['goals.items']).toHaveLength(2);
    expect(tables['core.dash_actions'][0].status).toBe('proposed');
  });
});

describe('mark_returned', () => {
  it('confirming records a full refund at cost; undoing deletes the return and the item is owned again', async () => {
    const { tables, deps, change } = setup({ kind: 'mark_returned', input: RETURN_INPUT });
    const confirmed = await confirmChange(deps, change.id as string);
    expect(confirmed.ok).toBe(true);
    expect(tables['public.returns']).toHaveLength(1);
    const ret = tables['public.returns'][0];
    expect(ret).toMatchObject({ inventory_item_id: ITEM, refund_amount_cents: 4500, status: 'refunded', refunded_at: '2026-09-29' });
    expect(tables['public.inventory_items'][0].status).toBe('returned');
    expect(confirmed.ok && confirmed.change).toMatchObject({
      writtenTable: 'public.inventory_items',
      writtenRef: ITEM,
      undo: { return_id: ret.id, refund_amount_cents: 4500 },
    });
    expect(tables['core.dash_actions'][0]).toMatchObject({
      subject_ref: `public.inventory_items:${ITEM}`,
      op: 'update',
      before_values: { id: ITEM, status: 'owned' },
      after_values: { id: ITEM, status: 'returned' },
    });

    const undone = await undoChange(deps, change.id as string);
    expect(undone.ok && undone.change.status).toBe('undone');
    expect(tables['public.returns']).toHaveLength(0);
    expect(tables['public.inventory_items'][0].status).toBe('owned');
  });

  it('refuses the undo once the item has been restored, or the refund changed', async () => {
    const restored = setup({ kind: 'mark_returned', input: RETURN_INPUT });
    await confirmChange(restored.deps, restored.change.id as string);
    restored.tables['public.inventory_items'][0].status = 'owned';
    const a = await undoChange(restored.deps, restored.change.id as string);
    expect(!a.ok && a.error).toBe('That item is no longer marked returned, so there is nothing to undo.');

    const edited = setup({ kind: 'mark_returned', input: RETURN_INPUT });
    await confirmChange(edited.deps, edited.change.id as string);
    edited.tables['public.returns'][0].refund_amount_cents = 3000;
    const b = await undoChange(edited.deps, edited.change.id as string);
    expect(!b.ok && b.error).toBe('You have changed that return since, so Dash will not remove it.');
    expect(edited.tables['public.returns']).toHaveLength(1);
  });
});

describe('what can be pressed when', () => {
  it('writes a change once however often Confirm is pressed', async () => {
    const { tables, deps, change } = setup();
    expect((await confirmChange(deps, change.id as string)).ok).toBe(true);
    const again = await confirmChange(deps, change.id as string);
    expect(again).toMatchObject({ ok: false, error: 'You have already confirmed this change.' });
    expect(tables['todo.tasks']).toHaveLength(1);
  });

  it('takes back its write when another press confirmed the change first', async () => {
    const { tables, deps, change, hooks } = setup();
    hooks.onTodo = () => {
      // The other window's confirm lands between this write and its mark.
      Object.assign(tables['core.dash_actions'][0], {
        status: 'done',
        done_at: '2026-09-29T11:59:00Z',
        subject_ref: `todo.tasks:${id(900)}`,
        op: 'insert',
      });
    };
    const confirmed = await confirmChange(deps, change.id as string);
    expect(confirmed).toMatchObject({ ok: false, error: 'You have already confirmed this change.' });
    expect(tables['todo.tasks']).toHaveLength(0);
  });

  it('never confirms a declined change, and declines only a proposal', async () => {
    const { tables, deps, change } = setup({ status: 'declined' });
    const confirmed = await confirmChange(deps, change.id as string);
    expect(!confirmed.ok && confirmed.error).toContain('You declined this change');
    expect(tables['todo.tasks']).toHaveLength(0);

    const fresh = setup();
    const declined = await declineChange(fresh.deps, fresh.change.id as string);
    expect(declined.ok && declined.change).toMatchObject({ status: 'declined', declinedAt: '2026-09-29T12:00:00Z' });
    expect(fresh.tables['todo.tasks']).toHaveLength(0);
    expect((await declineChange(fresh.deps, fresh.change.id as string)).ok).toBe(false);
  });

  it('refuses to undo a change that was never confirmed or is already undone', async () => {
    const { deps, change } = setup();
    expect(await undoChange(deps, change.id as string)).toMatchObject({
      ok: false,
      error: 'Nothing has been written yet, so there is nothing to undo.',
    });
    await confirmChange(deps, change.id as string);
    await undoChange(deps, change.id as string);
    expect(await undoChange(deps, change.id as string)).toMatchObject({
      ok: false,
      error: 'This change has already been undone.',
    });
  });

  it('waits for the answer to be kept, and for the workspace to be on', async () => {
    const early = setup({ turnId: null });
    expect(await confirmChange(early.deps, early.change.id as string)).toMatchObject({
      ok: false,
      error: 'Dash is still writing this answer. Try again once it has finished.',
    });
    const off = setup({ enabled: ['goals'] });
    expect(await confirmChange(off.deps, off.change.id as string)).toMatchObject({
      ok: false,
      error: 'The Todo workspace is switched off, so this cannot be written.',
    });
    expect(off.tables['todo.tasks']).toHaveLength(0);
  });

  it('answers for a change that is not there', async () => {
    const { deps } = setup();
    expect(await confirmChange(deps, id(999))).toEqual({ ok: false, error: 'That change is not there any more.', change: null });
  });
});

const WATCH_INPUT = {
  title: 'Jamie xx at Nowadays',
  url: 'https://www.crowdvolt.com/event/jamie-xx',
  below: 200,
  currency: 'USD',
  reportTimes: ['09:00'],
  endsAt: '2026-10-19T03:59:00.000Z',
  endsOn: '2026-10-18',
  goalItemId: id(2),
  goalTitle: 'Buy the tickets',
  pushOn: true,
};

describe('start_watch', () => {
  it('confirming inserts the running watch as the person, with no workspace needed; undoing removes it', async () => {
    const { tables, deps, change } = setup({ kind: 'start_watch', input: WATCH_INPUT, enabled: [] });
    const confirmed = await confirmChange(deps, change.id as string);
    expect(confirmed.ok).toBe(true);
    expect(tables['core.watches']).toEqual([
      expect.objectContaining({
        user_id: ME,
        title: 'Jamie xx at Nowadays',
        url: 'https://www.crowdvolt.com/event/jamie-xx',
        condition: { below: 200, currency: 'USD' },
        report_times: ['09:00'],
        ends_at: '2026-10-19T03:59:00.000Z',
        goal_item_id: id(2),
      }),
    ]);
    const watchId = tables['core.watches'][0].id as string;
    expect(confirmed.ok && confirmed.change).toMatchObject({ writtenTable: 'core.watches', writtenRef: watchId });
    expect(confirmed.ok && changeHref(confirmed.change)).toBe(`/home#watch-${watchId}`);

    // The run would set these; the fake leaves them unset.
    Object.assign(tables['core.watches'][0], { status: 'running', fired_at: null, reported_at: null });
    const undone = await undoChange(deps, change.id as string);
    expect(undone.ok).toBe(true);
    expect(tables['core.watches']).toEqual([]);
  });

  it('a report-only watch keeps an empty condition', async () => {
    const input = { ...WATCH_INPUT, below: null, currency: null, goalItemId: null, goalTitle: null };
    const { tables, deps, change } = setup({ kind: 'start_watch', input });
    expect((await confirmChange(deps, change.id as string)).ok).toBe(true);
    expect(tables['core.watches'][0]).toMatchObject({ condition: {}, goal_item_id: null });
  });

  it('refuses to start one that would already have ended, or a second on the same page', async () => {
    const late = setup({ kind: 'start_watch', input: { ...WATCH_INPUT, endsAt: '2026-09-29T11:00:00Z' } });
    expect(await confirmChange(late.deps, late.change.id as string)).toMatchObject({
      ok: false,
      error: 'That watch would already have ended. Ask Dash again with a later end.',
    });
    expect(late.tables['core.watches']).toEqual([]);

    const twice = setup({ kind: 'start_watch', input: WATCH_INPUT });
    twice.tables['core.watches'].push({ id: id(700), user_id: ME, url: WATCH_INPUT.url, status: 'running' });
    expect(await confirmChange(twice.deps, twice.change.id as string)).toMatchObject({ ok: false });
    expect(twice.tables['core.watches']).toHaveLength(1);
  });

  it('will not undo a watch that has pushed or been stopped', async () => {
    for (const [moved, error] of [
      [{ status: 'running', fired_at: '2026-09-30T10:00:00Z', reported_at: null }, 'already sent you a push'],
      [{ status: 'running', fired_at: null, reported_at: '2026-09-30T13:00:00Z' }, 'already sent you a push'],
      [{ status: 'stopped', fired_at: null, reported_at: null }, 'been stopped since'],
    ] as const) {
      const { tables, deps, change } = setup({ kind: 'start_watch', input: WATCH_INPUT });
      await confirmChange(deps, change.id as string);
      Object.assign(tables['core.watches'][0], moved);
      const undone = await undoChange(deps, change.id as string);
      expect(undone.ok).toBe(false);
      expect(!undone.ok && undone.error).toContain(error);
      expect(tables['core.watches']).toHaveLength(1);
    }
  });
});

describe('start_build', () => {
  const STEP = id(2106);
  const RUN = id(2107);
  const BUILD_INPUT = { stepId: STEP, number: 2200, outline: '2106.2', title: 'Start the session', quiet: false };
  const SENT = { ok: true, number: 2200, outline: '2106.2', title: 'Start the session', beneath: 0, detail: 'Started.', changed: true };

  beforeEach(() => handOver.mockReset());

  function build(input = BUILD_INPUT) {
    const made = setup({ kind: 'start_build', input, enabled: ['dev'] });
    made.tables['public.plan_runs'] = [{ id: RUN, user_id: ME, plan_item_id: STEP, created_at: '2026-09-29T12:00:00Z' }];
    return made;
  }

  it('confirming starts the session and settles the card against the run, with no undo', async () => {
    handOver.mockResolvedValue(SENT);
    const { deps, change } = build();
    const confirmed = await confirmChange(deps, change.id as string);
    expect(handOver).toHaveBeenCalledWith(expect.objectContaining({ userId: ME, id: STEP, confirmQuiet: undefined }));
    expect(confirmed.ok && confirmed.change).toMatchObject({ status: 'done', writtenTable: 'public.plan_runs', writtenRef: RUN });
    const undone = await undoChange(deps, change.id as string);
    expect(undone.ok).toBe(false);
  });

  it('shows the refusal and leaves the card waiting when the step changed after the card was made', async () => {
    handOver.mockResolvedValue({ ok: false, error: 'A session is already working on this step.' });
    const { tables, deps, change } = build();
    const confirmed = await confirmChange(deps, change.id as string);
    expect(confirmed).toMatchObject({ ok: false, error: 'A session is already working on this step.' });
    expect(tables['core.dash_actions'][0].status).toBe('proposed');
  });

  it('passes confirmQuiet only when the card said the last run was quiet', async () => {
    handOver.mockResolvedValue(SENT);
    const { deps, change } = build({ ...BUILD_INPUT, quiet: true });
    await confirmChange(deps, change.id as string);
    expect(handOver).toHaveBeenCalledWith(expect.objectContaining({ confirmQuiet: true }));
  });

  it('does nothing when the Dev workspace is off', async () => {
    const { deps, change } = setup({ kind: 'start_build', input: BUILD_INPUT, enabled: [] });
    const confirmed = await confirmChange(deps, change.id as string);
    expect(confirmed.ok).toBe(false);
    expect(handOver).not.toHaveBeenCalled();
  });
});

describe('paid_action', () => {
  const ran = vi.fn();
  const PAID_INPUT = {
    tool: 'write_year_review',
    action: 'app/timeline/actions.ts#writeYearReview',
    args: { year: 2026 },
    line: 'Write the review of 2026 from the timeline.',
    estimate: null,
    workspace: null,
    paths: ['/timeline/year/2026'],
  };
  const REVIEW = id(700);

  function paid(outcome: Awaited<ReturnType<DashPaidTool['run']>> | Error = { ok: true, subjectRef: `core.year_reviews:${REVIEW}`, op: 'insert', summary: 'Dash wrote the review of 2026.' }) {
    const made = setup({ kind: 'paid_action', input: PAID_INPUT });
    const tool = {
      name: 'write_year_review',
      kind: 'paid',
      workspace: null,
      run: async (ctx: unknown, args: unknown) => {
        ran(ctx, args);
        if (outcome instanceof Error) throw outcome;
        return outcome;
      },
    } as unknown as DashPaidTool;
    made.deps.paidTool = (name) => (name === tool.name ? tool : undefined);
    return made;
  }

  beforeEach(() => ran.mockReset());

  it('runs the tool once with the arguments it was queued with, and keeps the row it wrote with no Undo', async () => {
    const { deps, change, tables } = paid();
    const outcome = await confirmChange(deps, change.id as string);
    expect(outcome.ok).toBe(true);
    expect(ran).toHaveBeenCalledTimes(1);
    expect(ran.mock.calls[0][1]).toEqual({ year: 2026 });
    const row = tables['core.dash_actions'][0];
    expect(row).toMatchObject({ status: 'done', subject_ref: `core.year_reviews:${REVIEW}`, op: 'insert', summary: 'Dash wrote the review of 2026.' });
    expect(noUndoReason({ undo: row.undo as Row })).toBe(PAID_NO_UNDO);
    const undone = await undoChange(deps, change.id as string);
    expect(undone).toMatchObject({ ok: false, error: PAID_NO_UNDO });
  });

  it('runs nothing on a second approval, whether the first is still running or done', async () => {
    const { deps, change, tables } = paid();
    tables['core.dash_actions'][0].undo = { running_at: '2026-09-29T11:59:00Z' };
    expect(await confirmChange(deps, change.id as string)).toMatchObject({ ok: false, error: 'Dash is already running this.' });
    tables['core.dash_actions'][0].undo = null;
    await confirmChange(deps, change.id as string);
    expect(await confirmChange(deps, change.id as string)).toMatchObject({ ok: false });
    expect(ran).toHaveBeenCalledTimes(1);
  });

  it('keeps a failed run proposed with the reason, so it can be approved again', async () => {
    const { deps, change, tables } = paid({ ok: false, error: '2026 has 3 events on the timeline, too few to write about.' });
    const outcome = await confirmChange(deps, change.id as string);
    expect(outcome).toMatchObject({ ok: false, error: '2026 has 3 events on the timeline, too few to write about.' });
    expect(tables['core.dash_actions'][0]).toMatchObject({ status: 'proposed', undo: { failed: '2026 has 3 events on the timeline, too few to write about.' } });
    await confirmChange(deps, change.id as string);
    expect(ran).toHaveBeenCalledTimes(2);
  });

  it('says so when the run throws, and leaves it proposed', async () => {
    const { deps, change, tables } = paid(new Error('boom'));
    expect(await confirmChange(deps, change.id as string)).toMatchObject({ ok: false, error: 'Dash could not run this. Try again.' });
    expect(tables['core.dash_actions'][0].status).toBe('proposed');
  });

  it('is dismissed without running, but not while it runs', async () => {
    const { deps, change, tables } = paid();
    tables['core.dash_actions'][0].undo = { running_at: '2026-09-29T11:59:00Z' };
    expect((await declineChange(deps, change.id as string)).ok).toBe(false);
    tables['core.dash_actions'][0].undo = null;
    expect((await declineChange(deps, change.id as string)).ok).toBe(true);
    expect(await confirmChange(deps, change.id as string)).toMatchObject({ ok: false });
    expect(ran).not.toHaveBeenCalled();
  });

  it('is approved from a thread too', async () => {
    const { deps, change, tables } = paid();
    tables['core.dash_actions'][0].surface = 'thread';
    expect((await confirmChange(deps, change.id as string)).ok).toBe(true);
    expect(ran).toHaveBeenCalledTimes(1);
  });

  it('is refused when Dash no longer has the tool', async () => {
    const { deps, change } = paid();
    deps.paidTool = () => undefined;
    expect((await confirmChange(deps, change.id as string)).ok).toBe(false);
    expect(ran).not.toHaveBeenCalled();
  });
});

describe('delete_rows', () => {
  const A1 = id(701);
  const A2 = id(702);
  const row = (rid: string, answer: string): Row => ({
    id: rid,
    user_id: ME,
    application_id: id(50),
    question_id: id(rid === A1 ? 60 : 61),
    answer,
    status: 'draft',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
  });
  const input = () => ({
    table: 'job_search.application_answers',
    count: 2,
    titles: ['Why us?', 'Why this role?'],
    href: `/jobs/roles/${id(70)}`,
    rows: [row(A1, 'Same'), row(A2, 'Same')],
  });

  function pending() {
    const made = setup({ kind: 'delete_rows', input: input(), enabled: ['jobs'] });
    made.tables['job_search.application_answers'] = [row(A1, 'Same'), row(A2, 'Same')];
    return made;
  }

  it('confirming removes the named rows and records them for Undo; undoing puts them back', async () => {
    const { tables, deps, change } = pending();
    const confirmed = await confirmChange(deps, change.id as string);
    expect(confirmed.ok && confirmed.change).toMatchObject({ status: 'done', writtenTable: 'job_search.application_answers', writtenRef: A1 });
    expect(tables['job_search.application_answers']).toEqual([]);
    const recorded = tables['core.dash_actions'][0];
    expect(recorded.op).toBe('delete');
    expect((recorded.undo as { rows: unknown[] }).rows).toHaveLength(2);

    const undone = await undoChange(deps, change.id as string);
    expect(undone.ok && undone.change.status).toBe('undone');
    expect(tables['job_search.application_answers'].map((r) => r.id)).toEqual([A1, A2]);
    expect(tables['job_search.application_answers'][0]).toMatchObject({ answer: 'Same', created_at: '2026-09-01T00:00:00Z' });
  });

  it('declining removes nothing', async () => {
    const { tables, deps, change } = pending();
    const declined = await declineChange(deps, change.id as string);
    expect(declined.ok && declined.change.status).toBe('declined');
    expect(tables['job_search.application_answers']).toHaveLength(2);
    expect((await confirmChange(deps, change.id as string)).ok).toBe(false);
    expect(tables['job_search.application_answers']).toHaveLength(2);
  });

  it('removes nothing when a row changed since it was proposed, or the workspace is off', async () => {
    const edited = pending();
    edited.tables['job_search.application_answers'][1].answer = 'Rewritten';
    const refused = await confirmChange(edited.deps, edited.change.id as string);
    expect(refused).toMatchObject({ ok: false, error: expect.stringContaining('has changed') });
    expect(edited.tables['job_search.application_answers']).toHaveLength(2);
    expect(edited.tables['core.dash_actions'][0].status).toBe('proposed');

    const off = setup({ kind: 'delete_rows', input: input(), enabled: [] });
    off.tables['job_search.application_answers'] = [row(A1, 'Same'), row(A2, 'Same')];
    expect((await confirmChange(off.deps, off.change.id as string)).ok).toBe(false);
    expect(off.tables['job_search.application_answers']).toHaveLength(2);
  });

  it("refuses a table outside the allowed list and never touches another person's row", async () => {
    const other = setup({ kind: 'delete_rows', input: { ...input(), table: 'job_search.roles' }, enabled: ['jobs'] });
    other.tables['job_search.roles'] = [{ id: A1, user_id: ME }];
    expect((await confirmChange(other.deps, other.change.id as string)).ok).toBe(false);
    expect(other.tables['job_search.roles']).toHaveLength(1);

    const theirs = pending();
    theirs.tables['job_search.application_answers'] = [{ ...row(A1, 'Same'), user_id: id(9) }, { ...row(A2, 'Same'), user_id: id(9) }];
    expect((await confirmChange(theirs.deps, theirs.change.id as string)).ok).toBe(false);
    expect(theirs.tables['job_search.application_answers']).toHaveLength(2);
  });

  it('undo leaves a row that is already back and puts back the rest', async () => {
    const { tables, deps, change } = pending();
    await confirmChange(deps, change.id as string);
    tables['job_search.application_answers'].push(row(A1, 'Back already'));
    const undone = await undoChange(deps, change.id as string);
    expect(undone.ok).toBe(true);
    expect(tables['job_search.application_answers'].map((r) => r.id).sort()).toEqual([A1, A2]);
  });
});
