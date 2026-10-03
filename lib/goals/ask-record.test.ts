import { beforeEach, describe, expect, it, vi } from 'vitest';
import { undoDashAction } from '@/lib/core/dash-actions';
import { fakeDashDeps, fakeId, type FakeTables } from '../../tests/stubs/fake-schema-db';

/**
 * What a goal comment files is recorded in core.dash_actions (plan #1459):
 * each draft record, and a change to the step's date or Todo. Undoing the
 * record takes the draft away or puts the step back. The model and the reply
 * parser are stubbed, and the stores write into one in-memory database.
 */

const tables: FakeTables = {};
const ME = '00000000-0000-4000-8000-0000000000cc';
const STEP = '00000000-0000-4000-8000-000000000301';
const COLLECTION = { id: 'col-1', name: 'Loans', shape: 'many', fields: [], records: [] as unknown[] };

const mocks = vi.hoisted(() => ({ reply: { current: null as unknown } }));

vi.mock('@/lib/goals/comment-model', () => ({
  askGoalReplyModel: vi.fn(async () => ({ ok: true, input: {} })),
}));
vi.mock('@/lib/core/spend/session', () => ({ recordSessionSpend: vi.fn() }));
vi.mock('@/lib/goals/comments', async (original) => ({
  ...(await original<typeof import('@/lib/goals/comments')>()),
  goalReplyMessage: () => ({ message: 'm', refs: { collections: new Map() } }),
  parseGoalReply: () => mocks.reply.current,
}));
vi.mock('@/lib/goals/comments-store', () => ({
  loadThreads: vi.fn(async () => ({})),
  writeComment: vi.fn(),
}));
vi.mock('@/lib/goals/collections-store', () => ({
  loadCollectionsForGoal: vi.fn(async () => []),
  loadInformation: vi.fn(async () => ({})),
  addRecord: vi.fn(async (_c: unknown, userId: string, collectionId: string, values: Record<string, unknown>) => {
    const id = fakeId();
    (tables['goals.records'] ??= []).push({ id, user_id: userId, collection_id: collectionId, data: values, draft: true });
    return { ok: true, value: id };
  }),
}));
vi.mock('@/lib/goals/steps-store', () => ({
  loadGoalMap: vi.fn(async () => ({
    goal: { id: 'g', title: 'Clear the loans', status: 'open' },
    steps: [],
    information: {},
  })),
  updateStep: vi.fn(async (_c: unknown, id: string, fields: Record<string, unknown>) => {
    const row = tables['goals.items'].find((r) => r.id === id)!;
    Object.assign(row, fields);
    return true;
  }),
  setStepOnTodo: vi.fn(async (_c: unknown, id: string, onTodo: boolean) => {
    const row = tables['goals.items'].find((r) => r.id === id)!;
    row.on_todo = onTodo;
    return true;
  }),
}));

import { askDashOnGoal } from './ask';
import type { GoalsSupabaseClient } from './db/schema-name';

const client = {} as GoalsSupabaseClient;

function ask(dash: ReturnType<typeof fakeDashDeps>) {
  return askDashOnGoal({
    client,
    claude: client,
    userId: ME,
    today: '2026-10-03',
    goalId: 'g',
    itemId: STEP,
    itemTitle: 'Email the servicer',
    commentId: 'c',
    question: 'my balance is 12450, and do it Monday',
    apiKey: 'key',
    canRun: true,
    routine: { id: 'routine', token: 'token' },
    dash,
  });
}

beforeEach(() => {
  for (const key of Object.keys(tables)) delete tables[key];
  tables['goals.items'] = [
    { id: STEP, user_id: ME, level: 'step', title: 'Email the servicer', due_on: null, on_todo: false, updated_at: '2026-10-01T09:00:00Z' },
  ];
});

describe('goal comment filing', () => {
  it('records each draft it files, and undoing it takes the draft away', async () => {
    mocks.reply.current = { kind: 'answer', body: 'Filed it.', filings: [{ collection: COLLECTION, values: { balance: 12450 } }], schedule: null };
    const dash = fakeDashDeps(tables, ME);
    expect((await ask(dash)).ok).toBe(true);

    const [record] = tables['goals.records'];
    const [action] = tables['core.dash_actions'];
    expect(action).toMatchObject({
      surface: 'thread',
      kind: 'file_goal_record',
      status: 'done',
      op: 'insert',
      subject_ref: `goals.records:${record.id}`,
      after_values: { data: { balance: 12450 }, draft: true },
      summary: 'Filed a draft in Loans, from a comment on "Email the servicer".',
    });

    expect((await undoDashAction(dash, action.id as string)).ok).toBe(true);
    expect(tables['goals.records']).toHaveLength(0);
  });

  it('records a new date and Todo on the step, and undoing it puts both back', async () => {
    mocks.reply.current = { kind: 'answer', body: '', filings: [], schedule: { dueOn: '2026-10-05', onTodo: true } };
    const dash = fakeDashDeps(tables, ME);
    await ask(dash);

    expect(tables['goals.items'][0]).toMatchObject({ due_on: '2026-10-05', on_todo: true });
    const [action] = tables['core.dash_actions'];
    expect(action).toMatchObject({
      kind: 'schedule_goal_step',
      op: 'update',
      subject_ref: `goals.items:${STEP}`,
      before_values: { due_on: null, on_todo: false },
      after_values: { due_on: '2026-10-05', on_todo: true },
      summary: 'Set the due date on "Email the servicer" and put it on Todo.',
    });

    expect((await undoDashAction(dash, action.id as string)).ok).toBe(true);
    expect(tables['goals.items'][0]).toMatchObject({ due_on: null, on_todo: false });
  });
});
