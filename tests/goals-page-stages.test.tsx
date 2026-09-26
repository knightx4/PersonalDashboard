/**
 * The goal page opens on the work in hand (plan #1078): a goal in stages
 * shows its first unfinished stage open and folds every other stage to one
 * line, and a goal that is one list folds its finished steps under the open
 * ones.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildForest, type Step } from '@/lib/goals/steps';
import type { GoalMap } from '@/lib/goals/steps-store';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/goals/goal-role',
  useSearchParams: () => new URLSearchParams(),
}));

const { StepTree } = await import('@/app/goals/[goalId]/step-tree');

const GOAL = 'goal-role';

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
      areaId: 'career',
      title: 'Land your next role',
      acceptance: null,
      fog: null,
      status: 'open',
      position: 10,
      unit: null,
      target: null,
    },
    areaName: 'Career',
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

/** Each `<details>` in the markup, with whether it starts open and its text. */
function folds(html: string): { open: boolean; text: string }[] {
  return [...html.matchAll(/<details([^>]*)>([\s\S]*?)<\/summary>/g)].map((m) => ({
    open: /\bopen\b/.test(m[1]!),
    text: m[2]!.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
  }));
}

describe('a goal in stages', () => {
  const html = renderToStaticMarkup(
    <StepTree
      map={mapOf([
        step('interviews', { title: 'Walk into interviews ready', status: 'done', position: 5 }),
        step('answers', { title: 'Draft five answers', parentId: 'interviews', status: 'done' }),
        step('target', { title: 'Know the job you are aiming for', position: 10 }),
        step('traction', { title: 'See where your search got traction', parentId: 'target', status: 'done' }),
        step('floor', { title: 'Settle your pay floor', parentId: 'target', position: 20 }),
        step('resume', { title: 'Resume ready to send', position: 20 }),
        step('update', { title: 'Update your resume', parentId: 'resume' }),
      ])}
      todoOn={false}
    />,
  );

  it('opens on the first unfinished stage, with how far along it is', () => {
    expect(html).toContain('Stage 2 of 3');
    expect(html).toContain('1 of 2 done');
    expect(html).toContain('Settle your pay floor');
  });

  it('folds the finished stage and the later one, each saying where it stands', () => {
    const closed = folds(html).filter((fold) => !fold.open);
    expect(closed.map((fold) => fold.text)).toEqual([
      '1. Walk into interviews ready done',
      '3. Resume ready to send 1 step',
    ]);
  });
});

describe('a goal that is one list', () => {
  it('folds its finished steps under the open ones', () => {
    const html = renderToStaticMarkup(
      <StepTree
        map={mapOf([
          step('list', { title: 'List every balance', status: 'done', position: 10 }),
          step('call', { title: 'Call the card company', position: 20 }),
        ])}
        todoOn={false}
      />,
    );
    expect(folds(html)).toContainEqual({ open: false, text: 'Finished 1' });
    expect(html.indexOf('Call the card company')).toBeLessThan(html.indexOf('List every balance'));
  });
});
