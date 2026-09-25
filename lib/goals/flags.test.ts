import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withWaiting, type WaitingItem } from './daily';
import { flagRunText, flagsWaiting, type GoalFlag } from './flags';
import { answerGoalFlag } from './flags-store';

const mocks = vi.hoisted(() => ({
  loadShaping: vi.fn(),
  recordAndFire: vi.fn(),
}));
vi.mock('@/lib/feedback/routine', () => ({ resolveRoutineId: (id: string | null) => id }));
vi.mock('@/lib/goals/shaping-store', () => ({
  loadShaping: mocks.loadShaping,
  recordAndFire: mocks.recordAndFire,
}));

const USER = '11111111-1111-1111-1111-111111111111';
const GOAL = '33333333-3333-3333-3333-333333333333';
const FLAG = '22222222-2222-2222-2222-222222222222';

const flag = (over: Partial<GoalFlag> = {}): GoalFlag => ({
  id: FLAG,
  goalId: GOAL,
  title: 'Nelnet moved your due date to the 28th',
  detail: 'The September statement shows the new date. Autopay still runs on the 15th.',
  ask: null,
  status: 'open',
  createdAt: '2026-09-24T08:00:00Z',
  thread: [],
  ...over,
});

describe('flags under Waiting on you', () => {
  it('lists an open flag under the goal it names', () => {
    const titles = new Map([[GOAL, 'Pay off student debt']]);
    expect(flagsWaiting([flag()], titles)).toEqual([
      {
        kind: 'flag',
        id: FLAG,
        title: 'Nelnet moved your due date to the 28th',
        goalId: GOAL,
        goalTitle: 'Pay off student debt',
      },
    ]);
  });

  it('leaves off an answered flag, and one on a goal the home cannot name', () => {
    const titles = new Map([[GOAL, 'Pay off student debt']]);
    expect(flagsWaiting([flag({ status: 'answered' })], titles)).toEqual([]);
    expect(flagsWaiting([flag()], new Map())).toEqual([]);
  });

  it('sits after the questions and before the breakdowns', () => {
    const row = (kind: WaitingItem['kind'], id: string) =>
      ({ kind, id, title: id, goalId: GOAL, goalTitle: 'g', count: 1 }) as WaitingItem;
    const merged = withWaiting(
      [row('question', 'q1'), row('question', 'q2'), row('breakdown', 'b1'), row('review', 'r1')],
      [row('flag', 'f1')],
    );
    expect(merged.map((item) => item.id)).toEqual(['q1', 'q2', 'f1', 'b1', 'r1']);
  });
});

describe('the brief an answer starts', () => {
  it('carries the flag, what was said on it, the answer and both writes', () => {
    const text = flagRunText({
      runText: 'Work on one goal: "Pay off student debt"',
      userId: USER,
      flag: flag({ ask: 'Move autopay to the 28th?' }),
      history: [{ id: 'c1', author: 'claude', body: 'Found it on the statement.', createdAt: '2026-09-24T08:01:00Z' }],
      answer: 'Yes, move it and tell me when it is done.',
    });
    expect(text).toContain('Work on one goal: "Pay off student debt"');
    expect(text).toContain('Nelnet moved your due date to the 28th');
    expect(text).toContain('Asked: Move autopay to the 28th?');
    expect(text).toContain('Found it on the statement.');
    expect(text).toContain('## Their answer\n\nYes, move it and tell me when it is done.');
    expect(text).toContain(`'${FLAG}', 'claude'`);
    expect(text).toContain("set status = 'closed', outcome =");
    expect(text).toContain('"Flagging something on a goal"');
  });
});

/** A public client that hands back one flag and records the writes. */
function db(found: Record<string, unknown> | null) {
  const writes: { table: string; op: string; value: unknown }[] = [];
  const chain = (table: string, op: string, value?: unknown) => {
    const c: Record<string, unknown> = {};
    for (const name of ['eq', 'not', 'in', 'order', 'limit', 'select']) c[name] = () => c;
    c.maybeSingle = () => Promise.resolve({ data: found });
    c.single = () => Promise.resolve({ data: { id: 'c9' }, error: null });
    c.then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
    if (op !== 'select') writes.push({ table, op, value });
    return c;
  };
  return {
    writes,
    client: {
      from: (table: string) => ({
        select: () => chain(table, 'select'),
        insert: (value: unknown) => chain(table, 'insert', value),
        update: (value: unknown) => chain(table, 'update', value),
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  };
}

const goalsClient = {
  from: () => {
    const c: Record<string, unknown> = {};
    c.select = () => c;
    c.eq = () => c;
    c.maybeSingle = () => Promise.resolve({ data: { title: 'Pay off student debt' } });
    return c;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

const stored = {
  id: FLAG,
  goal_id: GOAL,
  title: 'Nelnet moved your due date to the 28th',
  detail: null,
  ask: null,
  status: 'open',
  created_at: '2026-09-24T08:00:00Z',
  thread: [],
};

describe('answering a flag', () => {
  beforeEach(() => {
    mocks.loadShaping.mockReset().mockResolvedValue({ approvedAt: null, lastRun: null });
    mocks.recordAndFire.mockReset().mockResolvedValue({ ok: true, detail: 'ok', runId: 'run-1' });
  });

  it('keeps the answer, starts a raise run on the goal with it, and marks the flag answered', async () => {
    const { client, writes } = db(stored);
    const outcome = await answerGoalFlag({
      supabase: client,
      client: goalsClient,
      userId: USER,
      id: FLAG,
      answer: 'Move autopay to the 28th.',
      canRun: true,
      routine: { id: 'trig_1', token: 't' },
    });

    expect(outcome.ok).toBe(true);
    expect(writes[0]).toMatchObject({ table: 'dev_comments', op: 'insert' });
    const fired = mocks.recordAndFire.mock.calls[0][0];
    expect(fired.job).toBe('raise');
    expect(fired.itemId).toBe(GOAL);
    expect(fired.text('run-1')).toContain('## Their answer\n\nMove autopay to the 28th.');
    expect(writes[1]).toMatchObject({ table: 'raised_items', op: 'update', value: { status: 'answered' } });
  });

  it('keeps the answer and the flag open when no run can start', async () => {
    const { client, writes } = db(stored);
    const outcome = await answerGoalFlag({
      supabase: client,
      client: goalsClient,
      userId: USER,
      id: FLAG,
      answer: 'Move it.',
      canRun: false,
      routine: { id: 'trig_1', token: 't' },
    });

    expect(outcome).toMatchObject({ ok: false });
    expect(mocks.recordAndFire).not.toHaveBeenCalled();
    expect(writes.map((w) => w.table)).toEqual(['dev_comments']);
  });
});
