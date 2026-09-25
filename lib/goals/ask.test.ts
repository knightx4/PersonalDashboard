/**
 * "@dash draft this for me" on a step hands that step to Claude (plan #1003).
 * The model, the stores and the hand-over are stubbed: what is checked is
 * which hand-over the comment starts and what the thread is told.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  askGoalReplyModel: vi.fn(),
  sendGoalStep: vi.fn(),
  recordAndFire: vi.fn(),
  writeComment: vi.fn(),
}));

vi.mock('@/lib/goals/comment-model', () => ({ askGoalReplyModel: mocks.askGoalReplyModel }));
vi.mock('@/lib/goals/handover-store', () => ({ sendGoalStep: mocks.sendGoalStep }));
vi.mock('@/lib/core/spend/session', () => ({ recordSessionSpend: vi.fn() }));
vi.mock('@/lib/feedback/routine', () => ({ resolveRoutineId: (id: string | null) => id }));
vi.mock('@/lib/goals/collections-store', () => ({
  addRecord: vi.fn(),
  loadCollectionsForGoal: vi.fn(async () => []),
  loadInformation: vi.fn(async () => ({})),
}));
vi.mock('@/lib/goals/comments-store', () => ({
  loadThreads: vi.fn(async () => ({})),
  writeComment: mocks.writeComment,
}));
vi.mock('@/lib/goals/shaping-store', () => ({
  loadShaping: vi.fn(async () => ({ lastRun: null })),
  recordAndFire: mocks.recordAndFire,
}));
vi.mock('@/lib/goals/steps-store', () => ({
  loadGoalMap: vi.fn(async () => ({
    goal: { id: 'g', title: 'Clear the loans', status: 'open', acceptance: null, fog: null, unit: null, target: null },
    steps: [
      step('mine-1', 'mine', 'Email the servicer'),
      step('claude-1', 'claude', 'Compare the repayment plans'),
    ],
    information: {},
  })),
}));

import { askDashOnGoal, type GoalAskInput } from './ask';
import type { GoalsSupabaseClient } from './db/schema-name';

function step(id: string, kind: string, title: string) {
  return {
    id,
    parentId: 'g',
    kind,
    status: 'open',
    title,
    detail: null,
    acceptance: null,
    resolution: null,
    dueOn: null,
    position: 10,
    rhythmCount: null,
    rhythmPeriod: null,
    onTodo: false,
    result: null,
    resultUrl: null,
    reviewedAt: null,
    children: [],
  };
}

const client = {
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { title: 'Clear the loans' } }) }) }) }),
} as unknown as GoalsSupabaseClient;

function input(extra: Partial<GoalAskInput> = {}): GoalAskInput {
  return {
    client,
    claude: client,
    userId: 'u',
    today: '2026-09-25',
    goalId: 'g',
    itemId: 'mine-1',
    itemTitle: 'Email the servicer',
    commentId: 'c',
    question: 'draft this for me',
    apiKey: 'key',
    canRun: true,
    routine: { id: 'routine', token: 'token' },
    ...extra,
  };
}

const said = () => mocks.writeComment.mock.calls.map((call) => (call[1] as { body: string }).body);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.askGoalReplyModel.mockResolvedValue({ ok: true, input: { send_step: true, needs_routine: false } });
});

describe('an @dash comment asking Claude to take the step', () => {
  it('prepares a step of yours, with the comment in the brief, and says so', async () => {
    mocks.sendGoalStep.mockResolvedValue({ ok: true, job: 'prepare', title: 'Email the servicer', runId: 'r' });
    const outcome = await askDashOnGoal(input());
    expect(mocks.sendGoalStep).toHaveBeenCalledWith(
      expect.objectContaining({ stepId: 'mine-1', mode: 'prepare', asked: 'draft this for me' }),
    );
    expect(outcome.ok).toBe(true);
    expect(said()).toEqual([
      'Claude is preparing "Email the servicer" for you. What it writes will show on the step, which stays yours.',
    ]);
  });

  it("sends a step of Claude's to be worked", async () => {
    mocks.sendGoalStep.mockResolvedValue({ ok: true, job: 'step', title: 'Compare the repayment plans', runId: 'r' });
    await askDashOnGoal(input({ itemId: 'claude-1', itemTitle: 'Compare the repayment plans', question: 'do this' }));
    expect(mocks.sendGoalStep).toHaveBeenCalledWith(expect.objectContaining({ stepId: 'claude-1', mode: 'send' }));
    expect(said()[0]).toBe(
      'Claude is working on "Compare the repayment plans". What it produces will show on the step when it is done.',
    );
  });

  it('says in the thread why the hand-over refused it', async () => {
    mocks.sendGoalStep.mockResolvedValue({ ok: false, error: 'That step is blocked.', refused: true });
    const outcome = await askDashOnGoal(input());
    expect(outcome).toEqual({ ok: false, error: 'I did not start it: That step is blocked.' });
    expect(said()).toEqual(['I did not start it: That step is blocked.']);
  });

  it('starts nothing for an account that may not run the routine', async () => {
    await askDashOnGoal(input({ canRun: false }));
    expect(mocks.sendGoalStep).not.toHaveBeenCalled();
    expect(said()[0]).toContain('only the account that owns this app can start one');
  });

  it('works the whole goal when the comment is on the goal itself', async () => {
    mocks.recordAndFire.mockResolvedValue({ ok: true, runId: 'r' });
    const outcome = await askDashOnGoal(input({ itemId: 'g', itemTitle: 'Clear the loans', question: 'do this' }));
    expect(mocks.sendGoalStep).not.toHaveBeenCalled();
    expect(mocks.recordAndFire).toHaveBeenCalledWith(expect.objectContaining({ job: 'goal', itemId: 'g' }));
    expect(outcome.ok).toBe(true);
  });
});
