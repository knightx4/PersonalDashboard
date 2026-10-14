import { beforeEach, describe, expect, it, vi } from 'vitest';
import { undoDashAction } from '@/lib/core/dash-actions';
import { fakeDashDeps, fakeId, type FakeTables } from '../../tests/stubs/fake-schema-db';

/**
 * What a goal comment files is recorded in core.dash_actions (plan #1459):
 * each draft record, and a change to the step's date or Todo. Undoing the
 * record takes the draft away or puts the step back. The model is a scripted
 * client calling the goal's own tools, and the stores write into one
 * in-memory database.
 */

const tables: FakeTables = {};
const ME = '00000000-0000-4000-8000-0000000000cc';
const STEP = '00000000-0000-4000-8000-000000000301';
const COLLECTION = vi.hoisted(() => ({ id: 'col-1', name: 'Loans', shape: 'many', fields: [], records: [] as unknown[] }));

vi.mock('@/lib/core/spend/session', () => ({ recordSessionSpend: vi.fn() }));
vi.mock('@/lib/goals/comments', async (original) => ({
  ...(await original<typeof import('@/lib/goals/comments')>()),
  goalReplyMessage: () => ({
    message: 'm',
    refs: {
      collections: new Map([['c1', COLLECTION]]),
      goals: new Map([
        ['g1', { id: 'g-car', title: 'Pay off the car', areaName: 'Money', errand: false }],
        ['g2', { id: 'g-buy', title: 'Buy a house', areaName: 'Home', errand: false }],
        ['g3', { id: 'g-fix', title: 'Fix up the house', areaName: 'Home', errand: false }],
      ]),
    },
  }),
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
    steps: [
      {
        id: '00000000-0000-4000-8000-000000000301',
        title: 'Email the servicer',
        children: [{ id: 'sub-1', title: 'Find the address', children: [] }],
      },
    ],
    information: {},
  })),
  moveStepToGoal: vi.fn(async (_c: unknown, id: string, goalId: string) => {
    const row = tables['goals.items'].find((r) => r.id === id)!;
    Object.assign(row, { parent_id: goalId, position: 40 });
    return { unlinked: false };
  }),
  setStepArchived: vi.fn(async (_c: unknown, id: string, archived: boolean) => {
    const row = tables['goals.items'].find((r) => r.id === id)!;
    row.archived_at = archived ? '2026-10-03T10:00:00Z' : null;
    return true;
  }),
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

import { answerCall, scriptedModel, stubThreadDash, toolCall, toolResults } from '../../tests/stubs/dash-model';
import { askDashOnGoal } from './ask';
import { writeComment } from './comments-store';
import { moveStepToGoal, setStepArchived } from './steps-store';
import type { GoalsSupabaseClient } from './db/schema-name';

const client = {} as GoalsSupabaseClient;

function ask(dash: ReturnType<typeof fakeDashDeps>, ...replies: unknown[]) {
  return askWith(dash, scriptedModel(replies));
}

function askWith(dash: ReturnType<typeof fakeDashDeps>, model: ReturnType<typeof scriptedModel>, itemId = STEP) {
  return askDashOnGoal({
    client,
    claude: client,
    userId: ME,
    today: '2026-10-03',
    goalId: 'g',
    itemId,
    itemTitle: 'Email the servicer',
    commentId: 'c',
    question: 'my balance is 12450, and do it Monday',
    apiKey: 'key',
    canRun: true,
    routine: { id: 'routine', token: 'token' },
    dash,
    dashThread: stubThreadDash(),
    anthropic: model.client,
  });
}

beforeEach(() => {
  for (const key of Object.keys(tables)) delete tables[key];
  tables['goals.items'] = [
    {
      id: STEP,
      user_id: ME,
      level: 'step',
      parent_id: 'g',
      position: 10,
      archived_at: null,
      title: 'Email the servicer',
      due_on: null,
      on_todo: false,
      updated_at: '2026-10-01T09:00:00Z',
    },
  ];
  vi.clearAllMocks();
});

describe('moving and archiving a step from its thread (plan #2035.1)', () => {
  it('moves the step under the goal named, says so with both goals, and undoing it puts it back', async () => {
    const dash = fakeDashDeps(tables, ME);
    const model = scriptedModel([
      toolCall('m', 'move_goal_step', { goal: 'g2', named: 'Buy a house' }),
      answerCall('Moved it.'),
    ]);
    const outcome = await askWith(dash, model);
    expect(outcome).toEqual({ ok: true, message: 'Done, and said in the thread.' });

    expect(tables['goals.items'][0]).toMatchObject({ parent_id: 'g-buy', position: 40 });
    const said = 'Moved "Email the servicer" from "Clear the loans" to "Buy a house", with its sub-step.';
    const [action] = tables['core.dash_actions'];
    expect(action).toMatchObject({
      surface: 'thread',
      kind: 'move_goal_step',
      op: 'update',
      subject_ref: `goals.items:${STEP}`,
      before_values: { parent_id: 'g', position: 10 },
      after_values: { parent_id: 'g-buy', position: 40 },
      summary: said,
    });
    expect(vi.mocked(writeComment).mock.calls.at(-1)?.[1].body).toContain(said);

    expect((await undoDashAction(dash, action.id as string)).ok).toBe(true);
    expect(tables['goals.items'][0]).toMatchObject({ parent_id: 'g', position: 10 });
  });

  it('changes nothing when the words fit two goals, and tells the model to ask which', async () => {
    const dash = fakeDashDeps(tables, ME);
    const model = scriptedModel([
      toolCall('m', 'move_goal_step', { goal: 'g2', named: 'the house' }),
      answerCall('Which house goal?'),
    ]);
    await askWith(dash, model);

    expect(vi.mocked(moveStepToGoal)).not.toHaveBeenCalled();
    expect(tables['goals.items'][0]).toMatchObject({ parent_id: 'g' });
    expect(tables['core.dash_actions'] ?? []).toHaveLength(0);
    expect(toolResults(model.sent).join(' ')).toContain('could be "Buy a house" or "Fix up the house"');
  });

  it('refuses a goal ref that is not listed', async () => {
    const dash = fakeDashDeps(tables, ME);
    const model = scriptedModel([toolCall('m', 'move_goal_step', { goal: 'g9', named: 'Garden' }), answerCall('Which goal?')]);
    await askWith(dash, model);
    expect(vi.mocked(moveStepToGoal)).not.toHaveBeenCalled();
    expect(toolResults(model.sent).join(' ')).toContain('Ask them which goal they mean');
  });

  it('archives the step, records it, and undoing it brings it back', async () => {
    const dash = fakeDashDeps(tables, ME);
    await ask(dash, toolCall('a', 'archive_goal_step', {}), answerCall('Archived it.'));

    expect(tables['goals.items'][0].archived_at).not.toBeNull();
    const [action] = tables['core.dash_actions'];
    expect(action).toMatchObject({
      kind: 'archive_goal_step',
      op: 'update',
      subject_ref: `goals.items:${STEP}`,
      before_values: { archived_at: null },
      summary: 'Archived "Email the servicer" from "Clear the loans", with its sub-step.',
    });

    expect((await undoDashAction(dash, action.id as string)).ok).toBe(true);
    expect(tables['goals.items'][0].archived_at).toBeNull();
  });

  it('changes nothing from a comment on the goal itself', async () => {
    const dash = fakeDashDeps(tables, ME);
    const model = scriptedModel([toolCall('a', 'archive_goal_step', {}), answerCall('Say which step.')]);
    await askWith(dash, model, 'g');
    expect(vi.mocked(setStepArchived)).not.toHaveBeenCalled();
    expect(toolResults(model.sent).join(' ')).toContain('on the goal itself');
  });
});

describe('goal comment filing', () => {
  it('records each draft it files, and undoing it takes the draft away', async () => {
    const dash = fakeDashDeps(tables, ME);
    const outcome = await ask(
      dash,
      toolCall('f', 'file_goal_record', { collection: 'c1', values: { balance: 12450 } }),
      answerCall('Filed it.'),
    );
    expect(outcome).toEqual({ ok: true, message: 'Answered, and filed as drafts.' });

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
    const dash = fakeDashDeps(tables, ME);
    await ask(dash, toolCall('s', 'schedule_goal_step', { due_on: '2026-10-05', on_todo: true }), answerCall('Done.'));

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
