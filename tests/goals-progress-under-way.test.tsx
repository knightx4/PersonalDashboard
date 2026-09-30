/**
 * A step with progress logged on it reads as under way on the goal page
 * (plan #1276): its tally in the row, and its entries newest first when it
 * is opened. Its parent says when anything beneath it was last logged, the
 * goal's heading says it for the whole tree, and entries logged on the goal
 * fold under it. A step with none looks as it always has.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { summariseProgress, type ProgressEntry } from '@/lib/goals/progress';
import { buildForest, type Step } from '@/lib/goals/steps';
import type { GoalMap } from '@/lib/goals/steps-store';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/goals/goal-move',
  useSearchParams: () => new URLSearchParams(),
}));

const { StepTree } = await import('@/app/goals/[goalId]/step-tree');

const GOAL = 'goal-move';
const TODAY = '2026-09-30';

function step(id: string, parentId: string, extra: Partial<Step> & { title: string }): Step {
  return {
    id,
    parentId,
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

function logged(
  id: string,
  itemId: string,
  happenedOn: string,
  text: string,
  quantity: number | null,
  unit: string | null,
): ProgressEntry {
  return {
    id,
    itemId,
    captureId: null,
    happenedOn,
    text,
    quantity,
    unit,
    estimate: null,
    createdAt: `${happenedOn}T09:00:00Z`,
  };
}

const steps = [
  step('room', GOAL, { title: 'Clear the living room', position: 10 }),
  step('bags', 'room', { title: 'Move the bags to the office', position: 10 }),
  step('shelf', 'room', { title: 'Take down the shelf', position: 20 }),
];

function render(entries: ProgressEntry[], opened = false) {
  const forest = buildForest([GOAL], steps);
  const map: GoalMap = {
    goal: {
      id: GOAL,
      areaId: 'home',
      title: 'Turn the office into a study',
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
  const progress = {
    today: TODAY,
    byItem: summariseProgress(entries, [{ id: GOAL, status: 'open', children: map.steps }]),
  };
  return renderToStaticMarkup(
    <StepTree map={map} todoOn={false} opened={opened} progress={progress} />,
  );
}

const entries = [
  logged('a', 'bags', '2026-09-27', 'moved five bags', 5, 'bags'),
  logged('b', 'bags', '2026-09-28', 'moved two bags from the living room to the office', 2, 'bags'),
  logged('g', GOAL, '2026-09-20', 'sold the old desk', null, null),
];

describe('a step under way', () => {
  it('shows its tally on the row and the latest activity above it and on the goal', () => {
    const html = render(entries);
    expect(html).toContain('7 bags so far');
    expect(html).toContain('Last logged 2 days ago');
    expect(html).toContain('Logged on the goal');
  });

  it('lists its entries newest first once opened', () => {
    const html = render(entries, true);
    expect(html).toContain('Under way · 7 bags so far · last logged 2 days ago');
    expect(html.indexOf('moved two bags from the living room')).toBeLessThan(
      html.indexOf('moved five bags'),
    );
  });

  it('leaves a tree with no entries as it was', () => {
    const html = render([], true);
    expect(html).not.toContain('so far');
    expect(html).not.toContain('Under way');
    expect(html).not.toContain('Last logged');
    expect(html).not.toContain('Logged on the goal');
  });
});
