import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSchemaDb, type FakeTables } from '../../tests/stubs/fake-schema-db';
import type { DashWriteContext, DashWriteResult } from './registry';

/**
 * Starting the goals routine from Ask Dash: start_goal_run is the goal
 * page's Ask Dash and work_goal_step a step row's. Each calls the function
 * the button calls, is refused as the button is, and is recorded with no
 * Undo, since a run that has begun cannot be taken back.
 */

const shaping = vi.hoisted(() => ({
  loadShaping: vi.fn(),
  startGoalRun: vi.fn(),
}));
const handover = vi.hoisted(() => ({ sendGoalStep: vi.fn() }));
vi.mock('@/lib/goals/shaping-store', () => shaping);
vi.mock('@/lib/goals/handover-store', () => handover);

const { GOAL_RUN_WRITE_TOOLS } = await import('./goal-run-writes');

const ME = '00000000-0000-4000-8000-0000000000aa';
const THEM = '00000000-0000-4000-8000-0000000000bb';
const GOAL = '44444444-4444-4444-8444-444444444444';
const STEP = '66666666-6666-4666-8666-666666666666';
const SUB = '77777777-7777-4777-8777-777777777777';
const THEIRS = '88888888-8888-4888-8888-888888888888';
const ROUTINE = { id: 'trig_goals', token: 'token' };

const item = (id: string, title: string, fields: Record<string, unknown> = {}) => ({
  id,
  user_id: ME,
  level: 'goal',
  parent_id: null,
  title,
  status: 'open',
  errand: false,
  due_on: null,
  archived_at: null,
  ...fields,
});

function tables(): FakeTables {
  return {
    'goals.items': [
      item(GOAL, 'Apply to economics graduate programs'),
      item(STEP, 'Research programs', { level: 'step', parent_id: GOAL, kind: 'claude' }),
      item(SUB, 'Shortlist', { level: 'step', parent_id: STEP, kind: 'claude' }),
      item(THEIRS, 'Not mine', { user_id: THEM }),
    ],
  };
}

function ctx(data: FakeTables, access: { canRun: boolean; routine: typeof ROUTINE } | null = { canRun: true, routine: ROUTINE }) {
  const db = fakeSchemaDb(data);
  return {
    userId: ME,
    today: '2026-10-30',
    enabledModules: ['goals'],
    db: async (schema: string) => db(schema),
    searchSources: [],
    seen: {},
    goals: async () => db('goals'),
    createTask: vi.fn(),
    ...(access ? { goalRoutine: async () => access } : {}),
  } as unknown as DashWriteContext;
}

const tool = (name: string) => GOAL_RUN_WRITE_TOOLS.find((t) => t.name === name)!;

async function run(name: string, context: DashWriteContext, input: Record<string, unknown>): Promise<DashWriteResult> {
  return tool(name).apply(context, input);
}

function error(result: DashWriteResult): string {
  if (result.ok) throw new Error(`expected a refusal, got ${result.summary}`);
  return result.error;
}

beforeEach(() => {
  shaping.loadShaping.mockReset().mockResolvedValue({ approvedAt: null, lastRun: null });
  shaping.startGoalRun.mockReset().mockResolvedValue({ ok: true, detail: 'fired', runId: 'run-1' });
  handover.sendGoalStep.mockReset().mockResolvedValue({ ok: true, job: 'send', title: 'Research programs', runId: 'run-2' });
});

describe('start_goal_run', () => {
  it("starts the goal page's run on the goal, with what they asked for in its brief", async () => {
    const result = await run('start_goal_run', ctx(tables()), {
      goal_ref: GOAL,
      instruction: 'A ranked shortlist with reach, target and safety reasons.',
    });
    expect(shaping.startGoalRun).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: ME,
        goal: { id: GOAL, title: 'Apply to economics graduate programs', errandDueOn: null },
        asked: 'A ranked shortlist with reach, target and safety reasons.',
        routine: ROUTINE,
      }),
    );
    if (!result.ok) throw new Error(result.error);
    expect(result).toMatchObject({
      kind: 'start_goal_run',
      subjectRef: `goals.items:${GOAL}`,
      op: 'update',
      undo: { none: expect.stringMatching(/^A run that has started cannot be taken back/) },
      row: { href: `/goals/${GOAL}` },
    });
    expect(result.summary).toBe(
      'Dash started mapping the goal "Apply to economics graduate programs", with what they asked for in its brief.',
    );
  });

  it('starts a plain map when nothing more was asked for', async () => {
    await run('start_goal_run', ctx(tables()), { goal_ref: GOAL });
    expect(shaping.startGoalRun).toHaveBeenCalledWith(expect.objectContaining({ asked: null }));
  });

  it('is refused for anyone but the owner, with no routine set, and where no run can start', async () => {
    expect(error(await run('start_goal_run', ctx(tables(), { canRun: false, routine: ROUTINE }), { goal_ref: GOAL }))).toMatch(
      /only the account that owns this app/,
    );
    expect(error(await run('start_goal_run', ctx(tables(), { canRun: true, routine: { id: '', token: '' } }), { goal_ref: GOAL }))).toMatch(
      /no goals routine is set/,
    );
    expect(error(await run('start_goal_run', ctx(tables(), null), { goal_ref: GOAL }))).toMatch(/^No run can be started from here/);
    expect(shaping.startGoalRun).not.toHaveBeenCalled();
  });

  it('is refused while a run on the goal is going', async () => {
    shaping.loadShaping.mockResolvedValue({
      approvedAt: null,
      lastRun: { status: 'started', created_at: new Date().toISOString(), last_seen_at: new Date().toISOString() },
    });
    expect(error(await run('start_goal_run', ctx(tables()), { goal_ref: GOAL }))).toMatch(/Dash is already working on/);
    expect(shaping.startGoalRun).not.toHaveBeenCalled();
  });

  it("is refused for a step, a closed goal and a goal that is not theirs", async () => {
    expect(error(await run('start_goal_run', ctx(tables()), { goal_ref: STEP }))).toMatch(/^That is a step, not a goal/);
    const data = tables();
    data['goals.items']![0]!.status = 'done';
    expect(error(await run('start_goal_run', ctx(data), { goal_ref: GOAL }))).toMatch(/^That goal is closed/);
    expect(error(await run('start_goal_run', ctx(tables()), { goal_ref: THEIRS }))).toMatch(/^There is nothing of theirs/);
  });
});

describe('work_goal_step', () => {
  it("hands the step over as its row's Ask Dash does, saying it came from Ask Dash", async () => {
    const result = await run('work_goal_step', ctx(tables()), { step_ref: SUB, instruction: 'Use the 2026 placement data.' });
    expect(handover.sendGoalStep).toHaveBeenCalledWith(
      expect.objectContaining({ stepId: SUB, mode: 'ask', asked: 'Use the 2026 placement data.', askedOn: 'chat', routine: ROUTINE }),
    );
    if (!result.ok) throw new Error(result.error);
    expect(result).toMatchObject({ kind: 'work_goal_step', row: { href: `/goals/${GOAL}/s/${SUB}` } });
    expect(result.summary).toBe('Dash started working the step "Research programs".');
  });

  it("passes on the hand-over's refusal", async () => {
    handover.sendGoalStep.mockResolvedValue({ ok: false, error: 'That step is waiting on another.', refused: true });
    expect(error(await run('work_goal_step', ctx(tables()), { step_ref: STEP }))).toBe('No run was started: That step is waiting on another.');
  });

  it('is refused for a goal', async () => {
    expect(error(await run('work_goal_step', ctx(tables()), { step_ref: GOAL }))).toMatch(/^That is a goal, not a step/);
  });
});
