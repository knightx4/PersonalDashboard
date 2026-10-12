import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseRef } from '@/lib/core/refs';
import type { TodoStep } from '@/lib/goals/todo';

/**
 * What the goal steps source puts on Todo (plans #927, #1735): only the steps
 * sent there, and events you said you would go to. Which steps come back is
 * todoSteps, tested in lib/goals/todo.test.ts; the loader here is a stand-in
 * handing back its output.
 */

const steps: TodoStep[] = [];
const going: unknown[] = [];
const setStepStatus = vi.fn();

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/goals/auth/server', () => ({ createGoalsClient: vi.fn() }));
vi.mock('@/lib/todo/agenda/clients', () => ({ sessionClients: { goals: async () => ({}) } }));
vi.mock('@/lib/goals/suggestions-store', () => ({
  loadGoingSuggestions: async () => going,
  recordAttended: vi.fn(),
}));
vi.mock('@/lib/todo/agenda/dismissals', () => ({ dismiss: vi.fn(), undismiss: vi.fn() }));
vi.mock('@/lib/goals/steps-store', () => ({
  loadTodoGoals: async () => ({ steps }),
  setStepStatus,
}));

const { goalStepsSource } = await import('./goal-steps');

const ctx = {
  userId: 'u',
  timezone: 'UTC',
  from: '2026-09-29',
  to: '2026-10-12',
  now: new Date('2026-09-29T12:00:00Z'),
};

function todoStep(id: string, extra: Partial<TodoStep> = {}): TodoStep {
  return { id, title: id, dueOn: null, startsOn: null, goalId: 'g', goalTitle: 'Goal', reason: null, ...extra };
}

describe('goalStepsSource', () => {
  beforeEach(() => {
    steps.length = 0;
    going.length = 0;
    setStepStatus.mockClear();
  });

  it('shows nothing when no step was sent and no event is on', async () => {
    expect(await goalStepsSource.fetch(ctx)).toEqual([]);
  });

  it("shows Dash's reason under a step Dash sent", async () => {
    steps.push(todoStep('s1', { reason: 'Due on the 13th' }), todoStep('s2'));
    const items = await goalStepsSource.fetch(ctx);
    expect(items.map((item) => item.detail)).toEqual(['Dash: Due on the 13th', null]);
  });

  it('names the row behind every kind of item by a ref', async () => {
    steps.push(todoStep('s1'));
    going.push({ id: 'e1', title: 'Concert', happensOn: '2026-10-01', startsAt: null, url: null, source: null, place: null, reaction: 'going', attended: null });

    const items = await goalStepsSource.fetch(ctx);
    expect(items.map((item) => item.ref)).toEqual(['goals.suggestions:e1', 'goals.items:s1']);
    for (const item of items) expect(parseRef(item.ref)).not.toBeNull();
  });

  it('puts an undated sent step in "On you, no date"', async () => {
    steps.push(todoStep('sent'));
    const items = await goalStepsSource.fetch(ctx);
    expect(items.map((item) => [item.key, item.day])).toEqual([['goal_steps:sent', null]]);
  });

  it('keeps a sent step on its own due date, late or not, and links it to its goal', async () => {
    steps.push(todoStep('late', { dueOn: '2026-09-01' }), todoStep('soon', { dueOn: '2026-10-03' }));
    const items = await goalStepsSource.fetch(ctx);
    expect(items.map((item) => [item.key, item.day, item.link?.href, item.completable])).toEqual([
      ['goal_steps:late', '2026-09-01', '/goals/g', true],
      ['goal_steps:soon', '2026-10-03', '/goals/g', true],
    ]);
  });

  it('leaves a step due past the horizon for when the horizon reaches it', async () => {
    steps.push(todoStep('far', { dueOn: '2026-12-01' }));
    expect(await goalStepsSource.fetch(ctx)).toEqual([]);
  });

  it('closes the step when it is ticked', async () => {
    await goalStepsSource.complete!(ctx, 'goal_steps:s1');
    expect(setStepStatus).toHaveBeenCalledWith(undefined, 's1', 'done');
  });

  it('refuses to tick a rhythm or question left on a page opened before', async () => {
    await expect(goalStepsSource.complete!(ctx, 'goal_rhythms:r1:2026-09-28')).rejects.toThrow();
    await expect(goalStepsSource.complete!(ctx, 'goal_questions:q1')).rejects.toThrow();
    expect(setStepStatus).not.toHaveBeenCalled();
  });

  it('answers nothing, since no question is on Todo', () => {
    expect(goalStepsSource.answer).toBeUndefined();
  });
});
