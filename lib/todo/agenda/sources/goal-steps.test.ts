import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TodoStep } from '@/lib/goals/todo';

/**
 * The day Todo gives a goal step (plan #1266). A goal's next step with no
 * date shows today; a step only flagged with Show on Todo keeps going in
 * "Someday". Which steps come back is goalTodoSteps, tested in
 * lib/goals/todo.test.ts; the loader here is a stand-in handing back its
 * output.
 */

const steps: TodoStep[] = [];

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/goals/auth/server', () => ({ createGoalsClient: vi.fn() }));
vi.mock('@/lib/todo/agenda/clients', () => ({ sessionClients: { goals: async () => ({}) } }));
vi.mock('@/lib/goals/rhythms-store', () => ({ countTowards: vi.fn() }));
vi.mock('@/lib/goals/suggestions-store', () => ({
  loadGoingSuggestions: async () => [],
  recordAttended: vi.fn(),
}));
vi.mock('@/lib/todo/agenda/dismissals', () => ({ dismiss: vi.fn(), undismiss: vi.fn() }));
vi.mock('@/lib/goals/steps-store', () => ({
  loadTodoGoals: async () => ({ steps, rhythms: [] }),
  setStepStatus: vi.fn(),
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
  return { id, title: id, dueOn: null, startsOn: null, goalId: 'g', goalTitle: 'Goal', ...extra };
}

describe('goalStepsSource', () => {
  beforeEach(() => {
    steps.length = 0;
  });

  it("shows an undated next step today and an undated flagged step with no day", async () => {
    steps.push(todoStep('next', { next: true }), todoStep('flagged'));
    const items = await goalStepsSource.fetch(ctx);
    expect(items.map((item) => [item.key, item.day])).toEqual([
      ['goal_steps:next', '2026-09-29'],
      ['goal_steps:flagged', null],
    ]);
  });

  it('keeps a next step on its own due date, late or not, and links it to its goal', async () => {
    steps.push(
      todoStep('late', { next: true, dueOn: '2026-09-01' }),
      todoStep('soon', { next: true, dueOn: '2026-10-03' }),
    );
    const items = await goalStepsSource.fetch(ctx);
    expect(items.map((item) => [item.key, item.day, item.link?.href, item.completable])).toEqual([
      ['goal_steps:late', '2026-09-01', '/goals/g', true],
      ['goal_steps:soon', '2026-10-03', '/goals/g', true],
    ]);
  });

  it('leaves a next step due past the horizon for when the horizon reaches it', async () => {
    steps.push(todoStep('far', { next: true, dueOn: '2026-12-01' }));
    expect(await goalStepsSource.fetch(ctx)).toEqual([]);
  });
});
