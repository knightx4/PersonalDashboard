import { describe, expect, it } from 'vitest';
import {
  allGoalsViewOf,
  areasInView,
  countAllGoalsView,
  goalInView,
  onYouByGoal,
} from './all-goals';
import { buildForest, markStartDates, type Step } from './steps';
import { todayRanked } from './today';
import type { AreaWithGoals, Goal } from './tree';

const TODAY = '2026-09-29';

function goal(id: string, extra: Partial<Goal> = {}): Goal {
  return {
    id,
    areaId: 'money',
    title: id,
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

/** What the page reads: the Today list over the live goals, counted per goal. */
function onYouOf(goals: Goal[], steps: Step[]): Map<string, number> {
  const { byGoal } = buildForest(
    goals.map((g) => g.id),
    steps,
  );
  markStartDates(byGoal, TODAY);
  return onYouByGoal(
    todayRanked({
      goals: goals.map((g) => ({ goal: g, areaName: 'Money' })),
      byGoal,
      today: TODAY,
      rhythms: [],
      flags: [],
      suggestions: [],
      didYouGo: [],
    }),
  );
}

describe('All goals views (plan #1158)', () => {
  const debt = goal('student-debt', { title: 'Pay off the student debt' });
  const dashOnly = goal('dash-only', { position: 20 });
  const finished = goal('finished', { status: 'done', position: 30 });
  const archived = goal('archived', { archivedAt: '2026-09-01T00:00:00Z', position: 5 });
  const live = [debt, dashOnly, finished];
  const onYou = onYouOf(live, [
    step('call-lender', debt.id, { title: 'Call the lender' }),
    step('research', dashOnly.id, { kind: 'claude' }),
    step('compare', dashOnly.id, { kind: 'claude', position: 20 }),
  ]);
  const areas: AreaWithGoals[] = [
    { id: 'money', name: 'Money', note: null, position: 10, goals: [archived, ...live] },
  ];

  it('On you lists a goal holding a step of yours and leaves out one whose open steps are all Dash’s', () => {
    expect(onYou.get(debt.id)).toBeGreaterThan(0);
    expect(onYou.get(dashOnly.id) ?? 0).toBe(0);
    const shown = areasInView(areas, 'you', onYou).flatMap((area) => area.goals.map((g) => g.id));
    expect(shown).toEqual([debt.id]);
  });

  it('Everything lists archived and finished goals, which Open does not', () => {
    const everything = areasInView(areas, 'all', onYou)[0].goals.map((g) => g.id);
    expect(everything).toEqual([debt.id, dashOnly.id, finished.id, archived.id]);
    const open = areasInView(areas, 'open', onYou)[0].goals.map((g) => g.id);
    expect(open).toEqual([debt.id, dashOnly.id]);
  });

  it('keeps the count of live goals an area archive would take', () => {
    expect(areasInView(areas, 'open', onYou)[0].liveCount).toBe(3);
  });

  it('counts goals per view for the chips', () => {
    expect(countAllGoalsView(areas, 'open', onYou)).toBe(2);
    expect(countAllGoalsView(areas, 'you', onYou)).toBe(1);
    expect(countAllGoalsView(areas, 'all', onYou)).toBe(4);
  });

  it('puts a goal Dash proposed on you, since it waits for your approval', () => {
    expect(goalInView(goal('proposed', { status: 'proposed' }), 'you', new Map())).toBe(true);
  });

  it('hides an area left empty by the view, but keeps an area with no goals yet in Open', () => {
    const fresh: AreaWithGoals = { id: 'city', name: 'City', note: null, position: 20, goals: [] };
    const done: AreaWithGoals = { ...fresh, id: 'done', goals: [finished] };
    expect(areasInView([fresh, done], 'open', onYou).map((a) => a.id)).toEqual(['city']);
    expect(areasInView([fresh, done], 'you', onYou)).toEqual([]);
    expect(areasInView([fresh, done], 'all', onYou).map((a) => a.id)).toEqual(['city', 'done']);
  });

  it('reads the view from the address, falling back to Open', () => {
    expect(allGoalsViewOf('you')).toBe('you');
    expect(allGoalsViewOf(['all'])).toBe('all');
    expect(allGoalsViewOf('ready')).toBe('open');
    expect(allGoalsViewOf(undefined)).toBe('open');
  });
});
