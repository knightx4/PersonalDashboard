import { describe, expect, it } from 'vitest';
import { dailyRunText } from './daily-run';
import { attachDependencies } from './dependencies';
import { STALE_AFTER_DAYS, staleLine, staleSteps, touchTimes } from './stale-steps';
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
    fog: null,
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
  options: { deps?: [string, string][]; today?: string; underWay?: string[] } = {},
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
  return staleSteps(goals, byGoal, times, NOW, new Set(options.underWay ?? []));
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
    const list = stale([goal('g')], [step('a', 'g'), step('b', 'g')], { a: 20, b: 20 }, {
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
      [step('a', 'g'), step('b', 'g'), step('c', 'g')],
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
    expect(text).toContain('"Moving a step\nthat has sat for a week"');
  });

  it('says nothing about moves when no step has sat', () => {
    const text = dailyRunText({ userId: 'u', runId: 'r', steps: [], review: [] });
    expect(text).not.toContain('Moving a step');
  });
});
