import { describe, expect, it } from 'vitest';
import { dailyRunText } from './daily-run';
import { PREP_CANDIDATE_LIMIT, prepCandidates, prepLine } from './prep-candidates';
import { buildForest, markStartDates, type Step } from './steps';
import type { Goal } from './tree';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-09-29T12:00:00Z');
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
    createdAt: daysAgo(1),
    ...extra,
  };
}

function candidates(goals: Goal[], steps: Step[], options: { today?: string; except?: string[] } = {}) {
  const { byGoal } = buildForest(
    goals.map((g) => g.id),
    steps,
  );
  if (options.today) markStartDates(byGoal, options.today);
  return prepCandidates(goals, byGoal, new Set(options.except ?? [])).map((c) => c.id);
}

describe('prepCandidates', () => {
  it('lists an open step of yours not judged yet', () => {
    expect(candidates([goal('g')], [step('a', 'g')])).toEqual(['a']);
  });

  it('leaves off a step already judged, prepared, or with a live prep step', () => {
    const steps = [
      step('judged', 'g', { prepCheckedAt: daysAgo(1) }),
      step('result', 'g', { result: 'A draft' }),
      step('link', 'g', { resultUrl: 'https://example.test/doc' }),
      step('served', 'g'),
      step('prep', 'g', { kind: 'claude', preparesId: 'served' }),
      step('servedDone', 'g'),
      step('prepDone', 'g', { kind: 'claude', preparesId: 'servedDone', status: 'done' }),
      step('servedDropped', 'g'),
      step('prepDropped', 'g', { kind: 'claude', preparesId: 'servedDropped', status: 'dropped' }),
    ];
    expect(candidates([goal('g')], steps)).toEqual(['servedDropped']);
  });

  it('leaves off a phase with open sub-steps and lists the sub-steps', () => {
    const steps = [
      step('phase', 'g', { createdAt: daysAgo(3) }),
      step('open', 'phase', { createdAt: daysAgo(2) }),
      step('finished', 'phase', { status: 'done' }),
      step('allDone', 'g', { createdAt: daysAgo(4) }),
      step('under', 'allDone', { status: 'done' }),
    ];
    expect(candidates([goal('g')], steps)).toEqual(['open', 'allDone']);
  });

  it('leaves off steps that are not open, not yours, or not reachable through open steps', () => {
    const steps = [
      step('blocked', 'g', { status: 'blocked', blockAsk: 'Which gym?', blockKind: 'outside' }),
      step('done', 'g', { status: 'done' }),
      step('claude', 'g', { kind: 'claude' }),
      step('underBlocked', 'blocked'),
    ];
    expect(candidates([goal('g')], steps)).toEqual([]);
    expect(candidates([goal('g', { status: 'done' })], [step('a', 'g')])).toEqual([]);
  });

  it('leaves off a step whose start date has not come', () => {
    const steps = [step('later', 'g', { startsOn: '2026-11-01' }), step('now', 'g')];
    expect(candidates([goal('g')], steps, { today: '2026-09-29' })).toEqual(['now']);
  });

  it('leaves off a step the brief lists as stale, before the cap', () => {
    const steps = Array.from({ length: PREP_CANDIDATE_LIMIT + 1 }, (_, i) =>
      step(`s${i}`, 'g', { createdAt: daysAgo(i) }),
    );
    const ids = candidates([goal('g')], steps, { except: ['s0'] });
    expect(ids).toHaveLength(PREP_CANDIDATE_LIMIT);
    expect(ids).not.toContain('s0');
    expect(ids).toContain(`s${PREP_CANDIDATE_LIMIT}`);
  });

  it('puts the newest first, across goals, and stops at the cap', () => {
    const goals = [goal('g'), goal('h')];
    const steps = [
      ...Array.from({ length: 8 }, (_, i) => step(`g${i}`, 'g', { createdAt: daysAgo(10 + i) })),
      ...Array.from({ length: 8 }, (_, i) => step(`h${i}`, 'h', { createdAt: daysAgo(0.5 + i * 2) })),
      step('unknown', 'g', { createdAt: null }),
    ];
    const ids = candidates(goals, steps);
    expect(ids).toHaveLength(PREP_CANDIDATE_LIMIT);
    expect(ids).toEqual(['h0', 'h1', 'h2', 'h3', 'h4', 'g0', 'h5', 'g1', 'g2', 'h6']);
  });
});

describe('the morning brief', () => {
  const review = [
    { id: 'g', title: 'Get fit', acceptance: null, lastDoneAt: null, quietDays: 1, stalled: false, last: null },
  ];

  it('lists the unjudged steps after the moves and before the verdicts, with the section', () => {
    const unjudged = [{ id: 'p', title: 'Apply to the gym job', goalId: 'g', goalTitle: 'Get fit', createdAt: null }];
    const text = dailyRunText({
      userId: 'u',
      runId: 'r',
      steps: [],
      review,
      stale: [{ id: 's', title: 'Book a trial class', goalId: 'g', goalTitle: 'Get fit', idleDays: 9, prepared: false }],
      unjudged,
    });
    const line = text.indexOf(prepLine(unjudged[0]));
    expect(prepLine(unjudged[0])).toBe('- "Apply to the gym job" (goals.items id p), under the goal "Get fit"');
    expect(line).toBeGreaterThan(text.indexOf('"Book a trial class"'));
    expect(line).toBeLessThan(text.indexOf('goals.reviews'));
    expect(text).toContain('"A Dash step before yours"');
    expect(text).toContain('prep_checked_at');
  });

  it('says nothing about judging when every step is judged', () => {
    const text = dailyRunText({ userId: 'u', runId: 'r', steps: [], review, unjudged: [] });
    expect(text).not.toContain('A Dash step before yours');
  });
});
