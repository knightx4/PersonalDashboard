/**
 * A step with progress entries on the goal page (plan #1276, under #1273):
 * under way, its running tally, the day it was last touched and its entries;
 * the parent and the goal say when anything beneath them last moved; and a
 * goal with no entries draws exactly as it did.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildForest, type Step } from '@/lib/goals/steps';
import type { GoalMap } from '@/lib/goals/steps-store';
import { summariseProgress, type ProgressEntry } from '@/lib/goals/progress';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/goals/goal-move',
  useSearchParams: () => new URLSearchParams(),
}));

const { StepTree } = await import('@/app/goals/[goalId]/step-tree');
const { StepFacts } = await import('@/app/goals/[goalId]/step-parts');

const GOAL = 'goal-move';

function step(id: string, extra: Partial<Step> & { title: string }): Step {
  return {
    id,
    parentId: GOAL,
    kind: 'mine',
    status: 'open',
    detail: null,
    acceptance: null,
    resolution: null,
    dismissedAt: null,
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

function mapOf(steps: Step[]): GoalMap {
  const forest = buildForest([GOAL], steps);
  return {
    goal: {
      id: GOAL,
      areaId: 'home',
      title: 'Settle into the apartment',
      acceptance: null,
      fog: null,
      status: 'open',
      position: 10,
      unit: null,
      target: null,
    },
    areaName: 'Home',
    steps: forest.byGoal.get(GOAL) ?? [],
    linked: [],
    otherGoals: [],
    linksOf: {},
    rhythms: {},
    information: {},
    answers: {},
    threads: {},
  };
}

function render(steps: Step[], entries: ProgressEntry[] = []) {
  return renderToStaticMarkup(
    <StepTree map={mapOf(steps)} todoOn={false} opened progress={summariseProgress(entries)} />,
  );
}

function entry(id: string, extra: Partial<ProgressEntry>): ProgressEntry {
  return {
    id,
    itemId: 'bags',
    captureId: null,
    happenedOn: '2026-09-28',
    text: 'moved some bags',
    quantity: null,
    unit: null,
    estimate: null,
    createdAt: '2026-09-28T10:00:00Z',
    ...extra,
  };
}

const phase = step('phase', { title: 'Move in', position: 10 });
const bags = step('bags', { title: 'Move the bags to their spot', parentId: 'phase' });
const shelf = step('shelf', { title: 'Put up the shelf', position: 20 });
const entries = [
  entry('e1', { text: 'moved two bags to the office', quantity: 2, unit: 'bags' }),
  entry('e2', {
    text: 'moved five bags from the living room',
    quantity: 5,
    unit: 'bags',
    happenedOn: '2026-09-29',
  }),
];

describe('a step with progress on it', () => {
  it('reads as under way with its tally, its last day and its entries newest first', () => {
    const html = render([phase, bags, shelf], entries);
    expect(html).toContain('Under way');
    expect(html).toContain('7 bags so far');
    // en-GB prints September as "Sep" or "Sept" depending on the ICU data.
    expect(html).toMatch(/last 29 Sept?</);
    const newer = html.indexOf('moved five bags from the living room');
    const older = html.indexOf('moved two bags to the office');
    expect(newer).toBeGreaterThan(-1);
    expect(older).toBeGreaterThan(newer);
  });

  // The goal's own last progress is in its status line (statusLine in
  // lib/goals/goal-status.ts), above the steps (plan #1078).
  it('tells the parent when it last moved', () => {
    const html = render([phase, bags, shelf], entries);
    expect(html).toMatch(
      /Last progress 29 Sept? on <a href="#step-bags"[^>]*>Move the bags to their spot</,
    );
  });

  it('says nothing on the row once the step is done', () => {
    const html = render([phase, { ...bags, status: 'done' }, shelf], entries);
    expect(html).not.toContain('Under way');
  });
});

describe('a goal with no progress', () => {
  it('looks as it did before', () => {
    const html = render([phase, bags, shelf]);
    expect(html).not.toContain('Under way');
    expect(html).not.toContain('Last progress');
    expect(html).not.toContain('so far');
    expect(html).toBe(
      renderToStaticMarkup(<StepTree map={mapOf([phase, bags, shelf])} todoOn={false} opened />),
    );
  });
});

describe('a step with an estimated total (plan #1277)', () => {
  const counted = { ...bags, estimatedTotal: 100, totalUnit: 'bags' };

  it('says about 93 to go when entries add to 7 of about 100 bags', () => {
    const html = render([phase, counted, shelf], entries);
    expect(html).toContain('7 of about 100 bags, about 93 to go');
    expect(html).not.toContain('7 bags so far');
    expect(html).toContain('About 100 bags in all');
  });

  it('offers the total and what it counts on the step itself', () => {
    const html = renderToStaticMarkup(
      <StepFacts node={{ ...counted, children: [] }} links={[]} otherGoals={[]} />,
    );
    expect(html).toMatch(
      /name="estimatedTotal"[^>]*value="100"|value="100"[^>]*name="estimatedTotal"/,
    );
    expect(html).toMatch(/name="totalUnit"[^>]*value="bags"|value="bags"[^>]*name="totalUnit"/);
  });
});

describe('a step with a rough answer to how far along (plan #1280)', () => {
  const answered = [entry('e3', { text: 'moved some bags', estimate: 'half' })];
  const onLine = /Under way<\/span><span class="tabular"> · (<!-- -->)?about half done/;

  it('says it on the row when the step has no total', () => {
    expect(render([phase, bags, shelf], answered)).toMatch(onLine);
  });

  it('gives way to a real total once there is one', () => {
    const counted = { ...bags, estimatedTotal: 100, totalUnit: 'bags' };
    const html = render([phase, counted, shelf], [...entries, ...answered]);
    expect(html).toContain('7 of about 100 bags, about 93 to go');
    expect(html).not.toMatch(onLine);
  });
});
