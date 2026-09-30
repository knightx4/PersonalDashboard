/**
 * "@dash draft this for me" on a step hands that step to Dash (plan #1003).
 * The model, the stores and the hand-over are stubbed: what is checked is
 * which hand-over the comment starts and what the thread is told.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  askGoalReplyModel: vi.fn(),
  sendGoalStep: vi.fn(),
  recordAndFire: vi.fn(),
  writeComment: vi.fn(),
  loadThreads: vi.fn(),
  updateStep: vi.fn(),
  setStepOnTodo: vi.fn(),
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
  loadThreads: mocks.loadThreads,
  writeComment: mocks.writeComment,
}));
vi.mock('@/lib/goals/shaping-store', () => ({
  loadShaping: vi.fn(async () => ({ lastRun: null })),
  recordAndFire: mocks.recordAndFire,
}));
vi.mock('@/lib/goals/steps-store', () => ({
  updateStep: mocks.updateStep,
  setStepOnTodo: mocks.setStepOnTodo,
  loadGoalMap: vi.fn(async () => ({
    goal: { id: 'g', title: 'Clear the loans', status: 'open', acceptance: null, fog: null, unit: null, target: null },
    steps: [
      step('mine-1', 'mine', 'Email the servicer'),
      step('claude-1', 'claude', 'Compare the repayment plans'),
      step('phase-mine', 'mine', 'Resume and LinkedIn ready to send', [
        step('mine-2', 'mine', 'Update your resume with your most recent role'),
      ]),
      step('phase-work', 'mine', 'Know the options', [
        step('claude-2', 'claude', 'List the lenders'),
      ]),
    ],
    information: {},
  })),
}));

import { askDashOnGoal, type GoalAskInput } from './ask';
import type { GoalsSupabaseClient } from './db/schema-name';

function step(id: string, kind: string, title: string, children: unknown[] = []) {
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
    children,
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
  mocks.loadThreads.mockResolvedValue({});
  mocks.askGoalReplyModel.mockResolvedValue({ ok: true, input: { send_step: true, needs_routine: false } });
});

describe('an @dash comment asking Dash to take the step', () => {
  it('prepares a step of yours, with the comment in the brief, and says so', async () => {
    mocks.sendGoalStep.mockResolvedValue({ ok: true, job: 'prepare', title: 'Email the servicer', runId: 'r' });
    const outcome = await askDashOnGoal(input());
    expect(mocks.sendGoalStep).toHaveBeenCalledWith(
      expect.objectContaining({ stepId: 'mine-1', mode: 'prepare', asked: 'draft this for me' }),
    );
    expect(outcome.ok).toBe(true);
    expect(said()).toEqual([
      'Dash is preparing "Email the servicer" for you. What it writes will show on the step, which stays yours.',
    ]);
  });

  it("sends a step of Dash's to be worked", async () => {
    mocks.sendGoalStep.mockResolvedValue({ ok: true, job: 'step', title: 'Compare the repayment plans', runId: 'r' });
    await askDashOnGoal(input({ itemId: 'claude-1', itemTitle: 'Compare the repayment plans', question: 'do this' }));
    expect(mocks.sendGoalStep).toHaveBeenCalledWith(expect.objectContaining({ stepId: 'claude-1', mode: 'send' }));
    expect(said()[0]).toBe(
      'Dash is working on "Compare the repayment plans". What it produces will show on the step when it is done.',
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

  it('passes what was said on the row before the comment into the hand-over', async () => {
    mocks.loadThreads.mockResolvedValue({
      'mine-1': [
        { id: 'c0', author: 'me', body: 'the account number is in my Drive under Loans' },
        { id: 'c', author: 'me', body: '@dash draft this for me' },
      ],
    });
    mocks.sendGoalStep.mockResolvedValue({ ok: true, job: 'prepare', title: 'Email the servicer', runId: 'r' });
    await askDashOnGoal(input());
    expect(mocks.sendGoalStep).toHaveBeenCalledWith(
      expect.objectContaining({
        thread: [{ author: 'me', body: 'the account number is in my Drive under Loans' }],
      }),
    );
  });

  it('hands a phase of only your own steps to the goals routine, which adds a Dash step', async () => {
    mocks.recordAndFire.mockResolvedValue({ ok: true, runId: 'r' });
    const outcome = await askDashOnGoal(
      input({ itemId: 'phase-mine', itemTitle: 'Resume and LinkedIn ready to send', question: 'no i want you to review it' }),
    );
    expect(mocks.sendGoalStep).not.toHaveBeenCalled();
    expect(mocks.recordAndFire).toHaveBeenCalledWith(expect.objectContaining({ job: 'goal', itemId: 'g' }));
    const brief = (mocks.recordAndFire.mock.calls[0][0] as { text: (runId: string) => string }).text('r');
    expect(brief).toContain('holds only your own steps');
    expect(brief).toContain('no i want you to review it');
    expect(outcome.ok).toBe(true);
  });

  it('still sends a phase that has steps of Dash\'s in it', async () => {
    mocks.sendGoalStep.mockResolvedValue({ ok: true, job: 'phase', title: 'Know the options', runId: 'r' });
    await askDashOnGoal(input({ itemId: 'phase-work', itemTitle: 'Know the options', question: 'do this' }));
    expect(mocks.sendGoalStep).toHaveBeenCalledWith(expect.objectContaining({ stepId: 'phase-work', mode: 'send' }));
    expect(mocks.recordAndFire).not.toHaveBeenCalled();
  });

  it('works the whole goal when the comment is on the goal itself', async () => {
    mocks.recordAndFire.mockResolvedValue({ ok: true, runId: 'r' });
    const outcome = await askDashOnGoal(input({ itemId: 'g', itemTitle: 'Clear the loans', question: 'do this' }));
    expect(mocks.sendGoalStep).not.toHaveBeenCalled();
    expect(mocks.recordAndFire).toHaveBeenCalledWith(expect.objectContaining({ job: 'goal', itemId: 'g' }));
    expect(outcome.ok).toBe(true);
  });
});

describe('an @dash comment asking for a date and Todo', () => {
  const dated = { needs_routine: false, schedule: { due_on: '2026-10-04', on_todo: true } };

  it('dates the step and puts it on Todo, and says so', async () => {
    mocks.askGoalReplyModel.mockResolvedValue({ ok: true, input: dated });
    mocks.updateStep.mockResolvedValue(true);
    mocks.setStepOnTodo.mockResolvedValue(true);
    const outcome = await askDashOnGoal(input({ question: 'make it Oct 4 and put it on my todos' }));
    expect(mocks.updateStep).toHaveBeenCalledWith(client, 'mine-1', { due_on: '2026-10-04' });
    expect(mocks.setStepOnTodo).toHaveBeenCalledWith(client, 'mine-1', true);
    expect(said()).toEqual(['Set the due date to Sun, Oct 4, 2026. Put it on your Todo.']);
    expect(outcome.ok).toBe(true);
  });

  it('says so when Todo refuses the step', async () => {
    mocks.askGoalReplyModel.mockResolvedValue({ ok: true, input: { needs_routine: false, schedule: { on_todo: true } } });
    mocks.setStepOnTodo.mockResolvedValue(false);
    await askDashOnGoal(input({ itemId: 'claude-1' }));
    expect(said()[0]).toContain('It did not go on Todo');
  });

  it('writes nothing on the goal itself', async () => {
    mocks.askGoalReplyModel.mockResolvedValue({ ok: true, input: dated });
    await askDashOnGoal(input({ itemId: 'g' }));
    expect(mocks.updateStep).not.toHaveBeenCalled();
    expect(said()[0]).toContain('belong to a step');
  });
});
