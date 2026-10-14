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
/** The step's own due date, which a test can set before asking. */
const STEP_DUE = vi.hoisted(() => ({ value: null as string | null }));
/** The goal's status, which a test can set to proposed before asking. */
const GOAL_STATUS = vi.hoisted(() => ({ value: 'open' as string }));
/** Whether the goal is an errand, and the run the shaping store reports. */
const ERRAND = vi.hoisted(() => ({ on: false, lastRun: null as unknown }));
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
vi.mock('@/lib/goals/store', () => ({
  loadAreas: vi.fn(async () => [
    { id: 'area-money', name: 'Money' },
    { id: 'area-home', name: 'Home' },
    { id: 'area-home-repairs', name: 'Home repairs' },
  ]),
  insertGoal: vi.fn(async (_c: unknown, userId: string, areaId: string, f: Record<string, unknown>) => {
    const id = fakeId();
    tables['goals.items'].push({
      id,
      user_id: userId,
      level: 'goal',
      area_id: areaId,
      title: f.title,
      errand: f.errand,
      due_on: f.dueOn,
      detail: f.detail,
      archived_at: null,
    });
    return id;
  }),
}));
vi.mock('@/lib/goals/shaping-store', () => ({
  loadShaping: vi.fn(async () => ({ lastRun: ERRAND.lastRun })),
  recordAndFire: vi.fn(),
  startGoalRun: vi.fn(async () => ({ ok: true, detail: 'fired', runId: 'run-1' })),
  approveGoal: vi.fn(async (_c: unknown, id: string) => {
    const goal = tables['goals.items'].find((r) => r.id === id);
    if (!goal) return null;
    goal.status = 'open';
    return 1;
  }),
}));
vi.mock('@/lib/goals/steps-store', () => ({
  loadGoalMap: vi.fn(async () => ({
    goal: { id: 'g', title: 'Clear the loans', status: GOAL_STATUS.value, areaId: 'area-money', ...(ERRAND.on ? { errand: true, dueOn: '2026-10-20' } : {}) },
    steps: [
      {
        id: '00000000-0000-4000-8000-000000000301',
        title: 'Email the servicer',
        status: 'open',
        dueOn: STEP_DUE.value,
        detail: 'Account 4471.',
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
import { approveGoal, startGoalRun } from './shaping-store';
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
  STEP_DUE.value = null;
  vi.clearAllMocks();
});

describe('making a step its own errand from its thread (plan #2035.2)', () => {
  const errands = () => tables['goals.items'].filter((row) => row.level === 'goal');

  it('makes the errand with the date and notes, archives the step, links it, and each change undoes', async () => {
    const dash = fakeDashDeps(tables, ME);
    const model = scriptedModel([
      toolCall('e', 'promote_step_to_errand', { due_on: '2026-10-20', notes: 'Ask about the payoff letter.' }),
      answerCall('Made it an errand.'),
    ]);
    const outcome = await askWith(dash, model);
    expect(outcome).toEqual({ ok: true, message: 'Done, and said in the thread.' });

    const [errand] = errands();
    expect(errand).toMatchObject({
      area_id: 'area-money',
      title: 'Email the servicer',
      errand: true,
      due_on: '2026-10-20',
      detail: 'Account 4471.\n\nAsk about the payoff letter.',
    });
    expect(tables['goals.items'][0].archived_at).not.toBeNull();

    const [added, archived] = tables['core.dash_actions'];
    expect(added).toMatchObject({
      surface: 'thread',
      kind: 'promote_step_to_errand',
      op: 'insert',
      subject_ref: `goals.items:${errand.id}`,
      summary: 'Made "Email the servicer" its own errand in Money, due 20 Oct 2026.',
    });
    expect(archived).toMatchObject({
      kind: 'promote_step_to_errand',
      op: 'update',
      subject_ref: `goals.items:${STEP}`,
      before_values: { archived_at: null },
      summary: 'Archived "Email the servicer" from "Clear the loans", with its sub-step, now that it is an errand.',
    });
    const body = vi.mocked(writeComment).mock.calls.at(-1)?.[1].body;
    expect(body).toContain(`[Email the servicer](/goals/${errand.id})`);

    expect((await undoDashAction(dash, archived.id as string)).ok).toBe(true);
    expect(tables['goals.items'][0].archived_at).toBeNull();
    expect((await undoDashAction(dash, added.id as string)).ok).toBe(true);
    expect(errands()).toHaveLength(0);
  });

  it("uses the step's own date when the comment gives none, in the area the comment names", async () => {
    STEP_DUE.value = '2026-11-02';
    const dash = fakeDashDeps(tables, ME);
    await ask(dash, toolCall('e', 'promote_step_to_errand', { area: 'the Home area' }), answerCall('Done.'));
    expect(errands()[0]).toMatchObject({ area_id: 'area-home', due_on: '2026-11-02', detail: 'Account 4471.' });
  });

  it('changes nothing with no date in the comment or on the step, and tells the model to ask for one', async () => {
    const dash = fakeDashDeps(tables, ME);
    const model = scriptedModel([toolCall('e', 'promote_step_to_errand', {}), answerCall('Which day is it due?')]);
    await askWith(dash, model);

    expect(errands()).toHaveLength(0);
    expect(vi.mocked(setStepArchived)).not.toHaveBeenCalled();
    expect(tables['core.dash_actions'] ?? []).toHaveLength(0);
    expect(toolResults(model.sent).join(' ')).toContain('ask them which day it is due');
  });

  it('changes nothing when the area named is not one of theirs', async () => {
    const dash = fakeDashDeps(tables, ME);
    const model = scriptedModel([
      toolCall('e', 'promote_step_to_errand', { due_on: '2026-10-20', area: 'Garden' }),
      answerCall('Which area?'),
    ]);
    await askWith(dash, model);
    expect(errands()).toHaveLength(0);
    expect(toolResults(model.sent).join(' ')).toContain('"Garden" is not one of their areas');
  });
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

describe('approving a proposed goal', () => {
  beforeEach(() => {
    GOAL_STATUS.value = 'open';
  });

  it('approves a proposed goal, records it, and undoing it puts it back', async () => {
    GOAL_STATUS.value = 'proposed';
    tables['goals.items'].push({ id: 'g', user_id: ME, level: 'goal', title: 'Clear the loans', status: 'proposed', archived_at: null });
    const dash = fakeDashDeps(tables, ME);
    await ask(dash, toolCall('p', 'approve_goal', {}), answerCall('Approved.'));

    expect(vi.mocked(approveGoal)).toHaveBeenCalledTimes(1);
    const [action] = tables['core.dash_actions'];
    expect(action).toMatchObject({
      kind: 'approve_goal',
      op: 'update',
      subject_ref: 'goals.items:g',
      before_values: { status: 'proposed' },
      summary: 'Approved "Clear the loans". 1 step is now live.',
    });
    expect(tables['goals.items'].find((r) => r.id === 'g')!.status).toBe('open');
    expect((await undoDashAction(dash, action.id as string)).ok).toBe(true);
    expect(tables['goals.items'].find((r) => r.id === 'g')!.status).toBe('proposed');
  });

  it('refuses a goal that is not waiting on approval', async () => {
    const dash = fakeDashDeps(tables, ME);
    const model = scriptedModel([toolCall('p', 'approve_goal', {}), answerCall('It is already open.')]);
    await askWith(dash, model);
    expect(vi.mocked(approveGoal)).not.toHaveBeenCalled();
    expect(tables['core.dash_actions'] ?? []).toHaveLength(0);
    expect(toolResults(model.sent).join(' ')).toContain('not a goal Dash proposed');
  });
});

describe('starting Dash on an errand', () => {
  beforeEach(() => {
    ERRAND.on = true;
    ERRAND.lastRun = null;
    vi.mocked(startGoalRun).mockClear();
  });

  it('starts the run briefed as an errand with its date, and records it as not undoable', async () => {
    const dash = fakeDashDeps(tables, ME);
    await ask(dash, toolCall('p', 'start_errand_run', {}), answerCall('Started.'));

    expect(vi.mocked(startGoalRun)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(startGoalRun).mock.calls[0][0]).toMatchObject({
      goal: { id: 'g', title: 'Clear the loans', errandDueOn: '2026-10-20' },
      surface: 'thread',
    });
    const [action] = tables['core.dash_actions'];
    expect(action).toMatchObject({ kind: 'start_errand_run', subject_ref: 'goals.items:g' });
    expect(action.summary).toBe('Started Dash on the errand "Clear the loans", due 20 Oct 2026.');
    expect((action.undo as { none?: string }).none).toContain('cannot be taken back');
  });

  it('starts nothing while a run is going', async () => {
    ERRAND.lastRun = { status: 'awaiting_input' };
    const dash = fakeDashDeps(tables, ME);
    const model = scriptedModel([toolCall('p', 'start_errand_run', {}), answerCall('It is already on it.')]);
    await askWith(dash, model);
    expect(vi.mocked(startGoalRun)).not.toHaveBeenCalled();
    expect(tables['core.dash_actions'] ?? []).toHaveLength(0);
    expect(toolResults(model.sent).join(' ')).toContain('already working');
  });

  it('starts nothing on a goal that is not an errand', async () => {
    ERRAND.on = false;
    const dash = fakeDashDeps(tables, ME);
    const model = scriptedModel([toolCall('p', 'start_errand_run', {}), answerCall('That is not an errand.')]);
    await askWith(dash, model);
    expect(vi.mocked(startGoalRun)).not.toHaveBeenCalled();
    expect(toolResults(model.sent).join(' ')).toContain('is not an errand');
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
