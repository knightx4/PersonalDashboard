import { describe, expect, it } from 'vitest';
import { dailyRunText } from './daily-run';
import { attachDependencies } from './dependencies';
import {
  STALE_AFTER_DAYS,
  openQuestionCount,
  restingAfterDefault,
  staleLine,
  staleSteps,
  touchTimes,
} from './stale-steps';
import { buildForest, markStartDates, type Step } from './steps';
import type { Goal } from './tree';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-09-27T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW - n * DAY).toISOString();

function goal(id: string, extra: Partial<Goal> = {}): Goal {
  return {
    id,
    areaId: 'area',
    title: `Goal ${id}`,
    acceptance: null,
    status: 'open',
    position: 10,
    unit: null,
    target: null,
    ...extra,
  };
}

function step(id: string, parentId: string, extra: Partial<Step> = {}): Step {
  return {
    id,
    parentId,
    kind: 'mine',
    status: 'open',
    title: id,
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
    ...extra,
  };
}

function stale(
  goals: Goal[],
  steps: Step[],
  touched: Record<string, number>,
  options: { deps?: [string, string][]; today?: string; underWay?: string[]; resting?: string[] } = {},
) {
  const { byGoal, nodes } = buildForest(
    goals.map((g) => g.id),
    steps,
  );
  attachDependencies(
    byGoal,
    nodes,
    (options.deps ?? []).map(([itemId, dependsOnId], i) => ({ id: `d${i}`, itemId, dependsOnId })),
  );
  if (options.today) markStartDates(byGoal, options.today);
  const times = new Map(Object.entries(touched).map(([id, days]) => [id, NOW - days * DAY]));
  return staleSteps(goals, byGoal, times, NOW, new Set(options.underWay ?? []), new Set(options.resting ?? []));
}

describe('touchTimes', () => {
  it('takes the newest of the row changing and a comment of yours on it', () => {
    const times = touchTimes(
      [
        { id: 'a', created_at: daysAgo(20), updated_at: daysAgo(12) },
        { id: 'b', created_at: daysAgo(9), updated_at: null },
      ],
      [
        { item_id: 'a', created_at: daysAgo(3) },
        { item_id: null, created_at: daysAgo(1) },
        { item_id: 'b', created_at: 'not a date' },
      ],
    );
    expect(times.get('a')).toBe(NOW - 3 * DAY);
    expect(times.get('b')).toBe(NOW - 9 * DAY);
  });

  it('counts a progress entry logged on the step as a touch', () => {
    const times = touchTimes(
      [{ id: 'a', created_at: daysAgo(20), updated_at: daysAgo(12) }],
      [],
      [{ item_id: 'a', created_at: daysAgo(2) }],
    );
    expect(times.get('a')).toBe(NOW - 2 * DAY);
  });
});

describe('staleSteps', () => {
  it('leaves out a step under way, which the progress nudge looks after instead', () => {
    const list = stale([goal('g'), goal('h')], [step('a', 'g'), step('b', 'h')], { a: 20, b: 20 }, {
      underWay: ['a'],
    });
    expect(list.map((s) => s.id)).toEqual(['b']);
  });

  it('reads a progress entry on a sub-step as a touch on the branch above it', () => {
    const progress = touchTimes(
      [
        { id: 'phase', created_at: daysAgo(20), updated_at: daysAgo(20) },
        { id: 'smaller', created_at: daysAgo(20), updated_at: daysAgo(20) },
      ],
      [],
      [{ item_id: 'smaller', created_at: daysAgo(1) }],
    );
    const { byGoal } = buildForest(['g'], [step('phase', 'g'), step('smaller', 'phase', { status: 'done' })]);
    expect(staleSteps([goal('g')], byGoal, progress, NOW)).toEqual([]);
  });

  it('lists a step of yours untouched for a week, longest first', () => {
    const list = stale(
      [goal('g')],
      [
        step('a', 'g', { dueOn: '2026-10-10' }),
        step('b', 'g', { dueOn: '2026-10-11' }),
        step('c', 'g', { onTodo: true }),
      ],
      { a: STALE_AFTER_DAYS, b: STALE_AFTER_DAYS - 1, c: 15 },
    );
    expect(list.map((s) => [s.id, s.idleDays])).toEqual([
      ['c', 15],
      ['a', 7],
    ]);
    expect(list[0]).toMatchObject({ goalId: 'g', goalTitle: 'Goal g', prepared: false });
  });

  it('counts a sub-step added or changed beneath as a touch, so a split moves it', () => {
    const list = stale(
      [goal('g')],
      [step('phase', 'g'), step('smaller', 'phase', { status: 'done' })],
      { phase: 20, smaller: 2 },
    );
    expect(list).toEqual([]);
  });

  it('lists the step beneath rather than a phase with open work under it', () => {
    const list = stale(
      [goal('g')],
      [step('phase', 'g'), step('under', 'phase')],
      { phase: 20, under: 10 },
    );
    expect(list.map((s) => s.id)).toEqual(['under']);
  });

  it('leaves a step waiting on a question or another step, a blocked one and one for later', () => {
    const list = stale(
      [goal('g')],
      [
        step('asked', 'g'),
        step('q', 'g', { kind: 'decision' }),
        step('blocked', 'g', { status: 'blocked', blockAsk: 'Your login', blockKind: 'outside' }),
        step('later', 'g', { startsOn: '2026-11-01' }),
      ],
      { asked: 10, q: 10, blocked: 10, later: 10 },
      { deps: [['asked', 'q']], today: '2026-09-27' },
    );
    expect(list).toEqual([]);
  });

  it("leaves Dash's steps, questions, rhythms, closed steps and goals not open", () => {
    const list = stale(
      [goal('g'), goal('p', { status: 'proposed' })],
      [
        step('claude', 'g', { kind: 'claude' }),
        step('q', 'g', { kind: 'decision' }),
        step('rhythm', 'g', { kind: 'rhythm', rhythmCount: 1, rhythmPeriod: 'week' }),
        step('done', 'g', { status: 'done' }),
        step('proposed', 'g', { status: 'proposed' }),
        step('elsewhere', 'p'),
      ],
      { claude: 10, q: 10, rhythm: 10, done: 10, proposed: 10, elsewhere: 10 },
    );
    expect(list).toEqual([]);
  });

  it("moves only a goal's first plain step, leaving the backlog after it to sit", () => {
    const list = stale(
      [goal('g'), goal('h')],
      [step('first', 'g'), step('second', 'g'), step('third', 'g'), step('other', 'h')],
      { first: 20, second: 20, third: 20, other: 9 },
    );
    expect(list.map((s) => s.id)).toEqual(['first', 'other']);
  });

  it('still moves a backlog step that is dated, on Todo or frees another', () => {
    const list = stale(
      [goal('g')],
      [
        step('first', 'g'),
        step('dated', 'g', { dueOn: '2026-10-20' }),
        step('todo', 'g', { onTodo: true }),
        step('frees', 'g'),
        step('waits', 'g'),
      ],
      { first: 9, dated: 10, todo: 11, frees: 12, waits: 1 },
      { deps: [['waits', 'frees']] },
    );
    expect(list.map((s) => s.id)).toEqual(['frees', 'todo', 'dated', 'first']);
  });

  it("gives a goal's plain steps no move while a question asked beside one is unanswered", () => {
    const steps = [
      step('q', 'g', { kind: 'decision', position: 5 }),
      step('asked', 'g'),
      step('next', 'g', { position: 20 }),
      step('dated', 'g', { position: 30, dueOn: '2026-10-20' }),
    ];
    const touched = { q: 3, asked: 20, next: 20, dated: 20 };
    const deps: [string, string][] = [['asked', 'q']];
    expect(stale([goal('g')], steps, touched, { deps }).map((s) => s.id)).toEqual(['dated']);

    const answered = steps.map((s) => (s.id === 'q' ? { ...s, status: 'done' as const, resolution: 'Keep it' } : s));
    expect(stale([goal('g')], answered, touched, { deps }).map((s) => s.id)).toEqual(['asked', 'dated']);
  });

  it('gives a goal at rest no moves at all', () => {
    const list = stale(
      [goal('g'), goal('h')],
      [step('a', 'g', { dueOn: '2026-10-10' }), step('b', 'h')],
      { a: 20, b: 20 },
      { resting: ['g'] },
    );
    expect(list.map((s) => s.id)).toEqual(['b']);
  });

  it('leaves a step with no known time off the list rather than calling it untouched', () => {
    expect(stale([goal('g')], [step('a', 'g')], {})).toEqual([]);
  });

  it('says when a step was already prepared, so preparing it again is the weakest move', () => {
    const [line] = stale([goal('g')], [step('a', 'g', { result: 'A call script.' })], { a: 8 });
    expect(line.prepared).toBe(true);
    expect(staleLine(line)).toBe(
      '- "a" (goals.items id a), under the goal "Goal g": untouched 8 days, already prepared once',
    );
  });
});

describe('restingAfterDefault', () => {
  it('rests a goal whose question closed unanswered in the last three weeks', () => {
    const { byGoal } = buildForest(
      ['g', 'h', 'k'],
      [
        step('qg', 'g', { kind: 'decision', status: 'done' }),
        step('phase', 'h'),
        step('qh', 'phase', { kind: 'decision', status: 'done' }),
        step('qk', 'k', { kind: 'decision', status: 'done' }),
      ],
    );
    const resting = restingAfterDefault(
      byGoal,
      [
        { id: 'qg', defaultedAt: daysAgo(2) },
        { id: 'qh', defaultedAt: daysAgo(20) },
        { id: 'qk', defaultedAt: daysAgo(22) },
      ],
      NOW,
    );
    expect([...resting].sort()).toEqual(['g', 'h']);
  });
});

describe('openQuestionCount', () => {
  it('counts the open questions not put aside, as the database cap does', () => {
    const { byGoal } = buildForest(
      ['g'],
      [
        step('open', 'g', { kind: 'decision' }),
        step('phase', 'g'),
        step('under', 'phase', { kind: 'decision' }),
        step('aside', 'g', { kind: 'decision', dismissedAt: daysAgo(1) }),
        step('answered', 'g', { kind: 'decision', status: 'done', resolution: 'A' }),
        step('mine', 'g'),
      ],
    );
    expect(openQuestionCount(byGoal)).toBe(2);
  });
});

describe('the morning brief', () => {
  it('puts the steps that have sat before the verdicts, with the section to follow', () => {
    const text = dailyRunText({
      userId: 'user-1',
      runId: 'run-1',
      steps: [],
      review: [
        {
          id: 'g',
          title: 'Get fit',
          acceptance: null,
          lastDoneAt: null,
          quietDays: 9,
          stalled: false,
          last: null,
        },
      ],
      stale: [
        { id: 's', title: 'Book a trial class', goalId: 'g', goalTitle: 'Get fit', idleDays: 9, prepared: false },
      ],
    });
    const moves = text.indexOf('"Book a trial class" (goals.items id s)');
    expect(moves).toBeGreaterThan(text.indexOf('Closing a step from evidence'));
    expect(moves).toBeLessThan(text.indexOf('goals.reviews'));
    expect(text).toContain('"Moving a step that has sat for a week"');
  });

  it('tells the run how many questions it has left, and to decide when none are', () => {
    const base = {
      userId: 'u',
      runId: 'r',
      steps: [],
      review: [
        { id: 'g', title: 'Home', acceptance: null, lastDoneAt: null, quietDays: 9, stalled: false, last: null },
      ],
      stale: [{ id: 's', title: 'Clear the desk', goalId: 'g', goalTitle: 'Home', idleDays: 9, prepared: false }],
    };
    expect(dailyRunText({ ...base, asksLeft: 2 })).toContain('Questions left: 2, across this whole run.');
    expect(dailyRunText({ ...base, asksLeft: 0 })).toContain('Questions left: none.');
    expect(dailyRunText(base)).not.toContain('Questions left');
  });

  it('says nothing about moves when no step has sat', () => {
    const text = dailyRunText({ userId: 'u', runId: 'r', steps: [], review: [] });
    expect(text).not.toContain('Moving a step');
  });
});
