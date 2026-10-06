import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseRef } from '@/lib/core/refs';
import type { TodoQuestion, TodoStep } from '@/lib/goals/todo';

/**
 * The day Todo gives a goal step (plan #1266). A goal's next step with no
 * date shows today; a step only flagged with Show on Todo keeps going in
 * "On you, no date". Which steps come back is goalTodoSteps, tested in
 * lib/goals/todo.test.ts; the loader here is a stand-in handing back its
 * output.
 */

const steps: TodoStep[] = [];
const questions: TodoQuestion[] = [];
const rhythms: unknown[] = [];
const going: unknown[] = [];
const answerQuestion = vi.fn(async () => true);

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/goals/auth/server', () => ({ createGoalsClient: vi.fn() }));
vi.mock('@/lib/todo/agenda/clients', () => ({ sessionClients: { goals: async () => ({}) } }));
vi.mock('@/lib/goals/rhythms-store', () => ({ countTowards: vi.fn() }));
vi.mock('@/lib/goals/suggestions-store', () => ({
  loadGoingSuggestions: async () => going,
  recordAttended: vi.fn(),
}));
vi.mock('@/lib/goals/shaping-store', () => ({ answerQuestion }));
vi.mock('@/lib/todo/agenda/dismissals', () => ({ dismiss: vi.fn(), undismiss: vi.fn() }));
vi.mock('@/lib/goals/steps-store', () => ({
  loadTodoGoals: async () => ({ steps, questions, rhythms }),
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
    questions.length = 0;
    rhythms.length = 0;
    going.length = 0;
    answerQuestion.mockClear();
  });

  it('names the row behind every kind of item by a ref', async () => {
    steps.push(todoStep('s1', { next: true }));
    questions.push({ id: 'q1', title: 'Which bank?', detail: null, goalId: 'g', goalTitle: 'Goal' });
    rhythms.push({ id: 'r1', startsOn: '2026-09-28', title: 'Run', goalId: 'g', goalTitle: 'Goal', period: 'week', target: 3, count: 1 });
    going.push({ id: 'e1', title: 'Concert', happensOn: '2026-10-01', startsAt: null, url: null, source: null, place: null, reaction: 'going', attended: null });

    const items = await goalStepsSource.fetch(ctx);
    expect(items.map((item) => item.ref)).toEqual([
      'goals.items:q1',
      'goals.items:r1',
      'goals.suggestions:e1',
      'goals.items:s1',
    ]);
    for (const item of items) expect(parseRef(item.ref)).not.toBeNull();
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

  it("shows an open question today with a button per option, the recommended one marked", async () => {
    questions.push({
      id: 'q1',
      title: 'Which bank?',
      detail: 'A — The local one. Close by.\nB — The online one. Cheaper.\nRecommend B: lower fees.',
      goalId: 'g',
      goalTitle: 'Goal',
    });
    const [item] = await goalStepsSource.fetch(ctx);
    expect(item).toMatchObject({
      key: 'goal_questions:q1',
      title: 'Which bank?',
      day: '2026-09-29',
      link: { href: '/goals/g/s/q1', label: 'Goal' },
      completable: false,
      options: [
        { letter: 'A', label: 'The local one', answer: 'A — The local one', recommended: false },
        { letter: 'B', label: 'The online one', answer: 'B — The online one', recommended: true },
      ],
    });
  });

  it('shows a question with no lettered options as a link to it, with no buttons', async () => {
    questions.push({ id: 'q2', title: 'What matters most?', detail: 'Say it in your words.', goalId: 'g', goalTitle: 'Goal' });
    const [item] = await goalStepsSource.fetch(ctx);
    expect(item.options).toBeUndefined();
    expect(item.link?.href).toBe('/goals/g/s/q2');
    expect(item.detail).toBe('Answer it on the goal');
  });

  it('answers a question through the goal page\'s write, and refuses anything else', async () => {
    expect(await goalStepsSource.answer!(ctx, 'goal_questions:q1', 'B — The online one')).toEqual({
      error: null,
    });
    expect(answerQuestion).toHaveBeenCalledWith(undefined, 'q1', 'B — The online one');
    expect((await goalStepsSource.answer!(ctx, 'goal_steps:s1', 'A')).error).toBeTruthy();
    expect((await goalStepsSource.answer!(ctx, 'goal_questions:q1', '  ')).error).toBeTruthy();
    answerQuestion.mockResolvedValueOnce(false);
    expect((await goalStepsSource.answer!(ctx, 'goal_questions:q1', 'A')).error).toBe(
      'That question was withdrawn or is gone.',
    );
  });

  it('will not tick a question', async () => {
    await expect(goalStepsSource.complete!(ctx, 'goal_questions:q1')).rejects.toThrow();
  });
});
