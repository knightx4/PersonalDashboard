import { describe, expect, it } from 'vitest';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import type { TaskInput } from '@/lib/todo/tasks/input';
import { changeHref, confirmChange, declineChange, undoChange, type ChangeDeps } from './changes';
import type { AskSchema, SchemaClient } from './db';

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
          is: (c: string, v: null) => (filters.push((r) => (r[c] ?? null) === v), query),
          gt: (c: string, v: number) => (filters.push((r) => (r[c] as number) > v), query),
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
    'core.dash_changes': [],
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
    turn_id: opts.turnId === undefined ? TURN : opts.turnId,
    kind: opts.kind ?? 'add_todo',
    input: opts.input ?? { title: 'Call the bank', body: null, dueOn: '2026-10-02', dueTime: null, pinned: false },
    status: opts.status ?? 'proposed',
    written_table: null,
    written_ref: null,
    undo: null,
    created_at: '2026-09-29T10:00:00Z',
    confirmed_at: opts.status === 'confirmed' ? '2026-09-29T10:01:00Z' : null,
    declined_at: opts.status === 'declined' ? '2026-09-29T10:01:00Z' : null,
    undone_at: null,
  };
  tables['core.dash_changes'].push(change);

  const created: TaskInput[] = [];
  const deps: ChangeDeps = {
    userId: ME,
    timezone: 'UTC',
    today: '2026-09-29',
    enabledModules: opts.enabled ?? ['todo', 'goals', 'shopping'],
    core: client('core'),
    db: async (schema: AskSchema) => client(schema),
    goals: async (history) => client('goals', history) as unknown as GoalsSupabaseClient,
    createTask: async (userId, input) => {
      created.push(input);
      const row = {
        id: id(++counter),
        user_id: userId,
        title: input.title,
        body: input.body,
        status: 'open',
        due_on: input.dueOn,
        due_at: null,
        pinned: input.pinned,
        snoozed_until: null,
        parent_id: null,
      };
      tables['todo.tasks'].push(row);
      return { id: row.id, error: null };
    },
    now: () => '2026-09-29T12:00:00Z',
  };
  return { tables, deps, change, created };
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
      status: 'confirmed',
      writtenTable: 'todo.tasks',
      writtenRef: task.id,
      confirmedAt: '2026-09-29T12:00:00Z',
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
      expect(tables['core.dash_changes'][0].status).toBe('confirmed');
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
    expect(confirmed.ok && changeHref(confirmed.change)).toBe(`/goals/${GOAL}#step-${steps[0].id}`);

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
      expect(tables['core.dash_changes'][0].status).toBe('confirmed');
    }
  });

  it('refuses to confirm under a goal that has since been closed', async () => {
    const { tables, deps, change } = setup({ kind: 'add_goal_step', input: STEP_INPUT });
    tables['goals.items'][0].status = 'done';
    const confirmed = await confirmChange(deps, change.id as string);
    expect(!confirmed.ok && confirmed.error).toBe('That goal is done now, so a step cannot go under it.');
    expect(tables['goals.items']).toHaveLength(2);
    expect(tables['core.dash_changes'][0].status).toBe('proposed');
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
    const { tables, deps, change } = setup();
    const createTask = deps.createTask;
    deps.createTask = async (...args) => {
      const out = await createTask(...args);
      // The other window's confirm lands between this write and its mark.
      Object.assign(tables['core.dash_changes'][0], {
        status: 'confirmed',
        confirmed_at: '2026-09-29T11:59:00Z',
        written_table: 'todo.tasks',
        written_ref: id(900),
      });
      return out;
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
