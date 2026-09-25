import { describe, expect, it } from 'vitest';
import { dailyView, NEXT_PER_GOAL, readWaiting, WAITING_GROUP } from './daily';
import { buildForest, type Step } from './steps';
import type { Goal } from './tree';

function goal(id: string, extra: Partial<Goal> = {}): { goal: Goal; areaName: string } {
  return {
    goal: {
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
    },
    areaName: 'Money',
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

const TODAY = '2026-09-24';

function view(goals: ReturnType<typeof goal>[], steps: Step[], today = TODAY) {
  const { byGoal } = buildForest(
    goals.map((g) => g.goal.id),
    steps,
  );
  return dailyView(goals, byGoal, today);
}

const nextIds = (result: ReturnType<typeof view>, goalId: string) =>
  result.goals.find((g) => g.goal.id === goalId)?.next.map((n) => n.id);

describe('dailyView next items', () => {
  it('lists only yours as next, and puts a ready Claude step on Dash’s list', () => {
    const result = view(
      [goal('g')],
      [step('c1', 'g', { kind: 'claude' }), step('m1', 'g'), step('m2', 'g')],
    );
    expect(nextIds(result, 'g')).toEqual(['m1', 'm2']);
    expect(result.dash.ready).toEqual([{ id: 'c1', title: 'c1', goalId: 'g', goalTitle: 'Goal g' }]);
  });

  it('orders by due date within each kind, undated after dated', () => {
    const result = view(
      [goal('g')],
      [
        step('undated', 'g'),
        step('later', 'g', { dueOn: '2026-10-05' }),
        step('sooner', 'g', { dueOn: '2026-09-30' }),
      ],
    );
    expect(nextIds(result, 'g')).toEqual(['sooner', 'later', 'undated']);
  });

  it(`shows at most ${NEXT_PER_GOAL} and counts the rest`, () => {
    const result = view(
      [goal('g')],
      ['a', 'b', 'c', 'd', 'e'].map((id) => step(id, 'g')),
    );
    const daily = result.goals[0];
    expect(daily.next.map((n) => n.id)).toEqual(['a', 'b', 'c']);
    expect(daily.more).toBe(2);
  });

  it('leaves Claude’s steps out of the cap on yours', () => {
    const result = view(
      [goal('g')],
      [...['c1', 'c2', 'c3'].map((id) => step(id, 'g', { kind: 'claude' })), step('m1', 'g')],
    );
    expect(nextIds(result, 'g')).toEqual(['m1']);
    expect(result.dash.ready.map((r) => r.id)).toEqual(['c1', 'c2', 'c3']);
  });

  it('shows the open sub-steps of a step rather than the step itself', () => {
    const result = view(
      [goal('g')],
      [
        step('parent', 'g', { title: 'Apply to jobs' }),
        step('child', 'parent'),
        step('closed', 'parent', { status: 'done' }),
      ],
    );
    const daily = result.goals[0];
    expect(daily.next.map((n) => n.id)).toEqual(['child']);
    expect(daily.next[0].under).toBe('Apply to jobs');
  });

  it('treats a step whose sub-steps are all closed as next', () => {
    const result = view(
      [goal('g')],
      [step('parent', 'g'), step('child', 'parent', { status: 'done' })],
    );
    expect(nextIds(result, 'g')).toEqual(['parent']);
  });

  it('skips closed, proposed, question and rhythm steps and what is under a closed one', () => {
    const result = view(
      [goal('g')],
      [
        step('done', 'g', { status: 'done' }),
        step('under-done', 'done'),
        step('dropped', 'g', { status: 'dropped' }),
        step('proposed', 'g', { status: 'proposed' }),
        step('question', 'g', { kind: 'decision' }),
        step('rhythm', 'g', { kind: 'rhythm', rhythmCount: 1, rhythmPeriod: 'week' }),
        step('real', 'g'),
      ],
    );
    expect(nextIds(result, 'g')).toEqual(['real']);
  });

  it('lists only open goals, and says when a goal has no steps', () => {
    const result = view(
      [goal('open'), goal('done', { status: 'done' }), goal('dropped', { status: 'dropped' })],
      [],
    );
    expect(result.goals.map((g) => g.goal.id)).toEqual(['open']);
    expect(result.goals[0].hasSteps).toBe(false);
  });
});

describe('dailyView waiting on you', () => {
  it('lists an unanswered question and not an answered one', () => {
    const result = view(
      [goal('g')],
      [
        step('ask', 'g', { kind: 'decision', title: 'Strength or endurance?' }),
        step('answered', 'g', { kind: 'decision', resolution: 'Strength' }),
      ],
    );
    expect(result.waiting).toEqual([
      {
        kind: 'question',
        id: 'ask',
        title: 'Strength or endurance?',
        goalId: 'g',
        goalTitle: 'Goal g',
      },
    ]);
  });

  it('counts a proposed breakdown once per goal, including proposed sub-steps', () => {
    const result = view(
      [goal('g')],
      [
        step('p1', 'g', { status: 'proposed' }),
        step('p1a', 'p1', { status: 'proposed' }),
        step('p2', 'g', { status: 'proposed', kind: 'decision' }),
        step('open', 'g'),
      ],
    );
    expect(result.waiting).toEqual([
      { kind: 'breakdown', id: 'g', title: 'Goal g', goalId: 'g', goalTitle: 'Goal g', count: 3 },
    ]);
  });

  it('lists a proposed goal once, none of its steps, and its Claude steps as held', () => {
    const result = view(
      [goal('p', { status: 'proposed' })],
      [
        step('q', 'p', { kind: 'decision' }),
        step('s', 'p', { status: 'proposed' }),
        step('c', 's', { status: 'proposed', kind: 'claude' }),
      ],
    );
    expect(result.goals).toEqual([]);
    expect(result.waiting.map((w) => [w.kind, w.id])).toEqual([['plan', 'area']]);
    expect(result.dash.held).toEqual([{ goalId: 'p', goalTitle: 'Goal p', count: 1, on: 'goal' }]);
  });

  it('groups the goals Claude proposed in one area into one row', () => {
    const result = view(
      [
        goal('a', { status: 'proposed' }),
        goal('b', { status: 'proposed' }),
        goal('c', { status: 'proposed', areaId: 'other' }),
      ],
      [],
    );
    expect(result.waiting).toEqual([
      {
        kind: 'plan',
        id: 'area',
        title: 'Money',
        goalId: 'a',
        goalTitle: 'Goal a',
        count: 2,
        goals: [
          { id: 'a', title: 'Goal a' },
          { id: 'b', title: 'Goal b' },
        ],
      },
      {
        kind: 'plan',
        id: 'other',
        title: 'Money',
        goalId: 'c',
        goalTitle: 'Goal c',
        count: 1,
        goals: [{ id: 'c', title: 'Goal c' }],
      },
    ]);
    expect(result.waiting.map((w) => WAITING_GROUP[w.kind])).toEqual(['approve', 'approve']);
  });

  it('holds a Claude step inside a proposal on an approved goal', () => {
    const result = view(
      [goal('g')],
      [step('p', 'g', { status: 'proposed' }), step('c', 'p', { status: 'proposed', kind: 'claude' })],
    );
    expect(result.dash.held).toEqual([{ goalId: 'g', goalTitle: 'Goal g', count: 1, on: 'steps' }]);
    expect(result.dash.ready).toEqual([]);
  });

  it('orders questions, then breakdowns, then proposed goals, each in page order', () => {
    const result = view(
      [goal('a', { status: 'proposed' }), goal('b'), goal('c')],
      [
        step('b-prop', 'b', { status: 'proposed' }),
        step('b-ask', 'b', { kind: 'decision' }),
        step('c-ask', 'c', { kind: 'decision' }),
      ],
    );
    expect(result.waiting.map((w) => [w.kind, w.id])).toEqual([
      ['question', 'b-ask'],
      ['question', 'c-ask'],
      ['breakdown', 'b'],
      ['plan', 'area'],
    ]);
  });

  it('lists a Claude result until you mark it read, after breakdowns and before proposed goals', () => {
    const result = view(
      [goal('a', { status: 'proposed' }), goal('b')],
      [
        step('b-prop', 'b', { status: 'proposed' }),
        step('draft', 'b', { kind: 'claude', status: 'done', result: 'Three gyms…' }),
        step('linked', 'b', { kind: 'claude', status: 'done', resultUrl: 'https://example.test' }),
        step('read', 'b', {
          kind: 'claude',
          status: 'done',
          result: 'Old note',
          reviewedAt: '2026-09-23T12:00:00Z',
        }),
        step('dropped', 'b', { kind: 'claude', status: 'dropped', result: 'Never mind' }),
        step('pending', 'b', { kind: 'claude' }),
      ],
    );
    expect(result.waiting.map((w) => [w.kind, w.id])).toEqual([
      ['breakdown', 'b'],
      ['review', 'draft'],
      ['review', 'linked'],
      ['plan', 'area'],
    ]);
    // The unworked Claude step is Dash's next, and a closed one is nobody's.
    expect(nextIds(result, 'b')).toEqual([]);
    expect(result.dash.ready.map((r) => r.id)).toEqual(['pending']);
  });
});

describe('dailyView after time away', () => {
  it('lists overdue steps as ordinary next items with no date', () => {
    // Two weeks away: both dated steps have passed.
    const result = view(
      [goal('g')],
      [
        step('late', 'g', { dueOn: '2026-09-08' }),
        step('later', 'g', { dueOn: '2026-09-15' }),
        step('undated', 'g'),
      ],
    );
    const next = result.goals[0].next;
    expect(next.map((n) => n.id)).toEqual(['late', 'later', 'undated']);
    expect(next.map((n) => n.dueOn)).toEqual([null, null, null]);
  });

  it('ranks an overdue step as due today, not ahead of what is due today', () => {
    const result = view(
      [goal('g')],
      [
        step('today', 'g', { dueOn: TODAY }),
        step('late', 'g', { dueOn: '2026-09-01' }),
        step('soon', 'g', { dueOn: '2026-09-26' }),
      ],
    );
    const next = result.goals[0].next;
    expect(next.map((n) => n.id)).toEqual(['today', 'late', 'soon']);
    expect(next.map((n) => n.dueOn)).toEqual([TODAY, null, '2026-09-26']);
  });
});

describe('what else waits to be read', () => {
  it('names the context and drafts found for each goal, and skips a goal with none', () => {
    const rows = readWaiting(
      new Map([['g1', 3]]),
      new Map([
        ['g1', 1],
        ['g2', 2],
        ['gone', 5],
      ]),
      new Map([
        ['g1', 'Know what job you are aiming for'],
        ['g2', 'Pay off student debt'],
      ]),
    );
    expect(rows.map((r) => [r.kind, r.goalId, 'count' in r ? r.count : null])).toEqual([
      ['context', 'g1', 3],
      ['drafts', 'g1', 1],
      ['drafts', 'g2', 2],
    ]);
    expect(rows.every((r) => WAITING_GROUP[r.kind] === 'read')).toBe(true);
  });
});
