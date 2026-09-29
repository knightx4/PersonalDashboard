/**
 * A Dash prep step said on the step it serves (plan #1218, under #1207):
 * "Dash is preparing" with its title while open, "Dash prepared" with the
 * first sentence of its result once done, and the prep step's own row
 * names the step it is for.
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

function render(steps: Step[]) {
  const forest = buildForest([GOAL], steps);
  const map: GoalMap = {
    goal: {
      id: GOAL,
      areaId: 'work',
      title: 'Land your next role',
      acceptance: null,
      fog: null,
      status: 'open',
      position: 10,
      unit: null,
      target: null,
    },
    areaName: 'Work',
    steps: forest.byGoal.get(GOAL) ?? [],
    linked: [],
    otherGoals: [],
    linksOf: {},
    rhythms: {},
    information: {},
    answers: {},
    threads: {},
  };
  return renderToStaticMarkup(<StepTree map={map} todoOn={false} opened />);
}

const apply = step('apply', { title: 'Apply to Kroll', position: 20 });
const prep = (extra: Partial<Step> = {}) =>
  step('prep', {
    kind: 'claude',
    title: 'Draft the Kroll cover letter',
    preparesId: 'apply',
    position: 10,
    ...extra,
  });

describe('a Dash prep step on the step it serves', () => {
  it('says an open one is preparing, by its title, linked to its row', () => {
    const html = render([prep(), apply]);
    expect(html).toContain('Dash is preparing: ');
    expect(html).toMatch(/href="#step-prep"[^>]*>Draft the Kroll cover letter</);
  });

  it('gives a finished one its first result sentence and links to the whole result', () => {
    const html = render([
      prep({ status: 'done', result: 'A letter leading on the fraud work. More below.' }),
      apply,
    ]);
    expect(html).toContain('Dash prepared: ');
    expect(html).toContain('A letter leading on the fraud work.');
    expect(html).toMatch(/href="#step-prep"[^>]*>Read it</);
  });

  it('names the step a prep step is for on its own row', () => {
    expect(render([prep(), apply])).toMatch(/href="#step-apply"[^>]*>For Apply to Kroll</);
  });

  it('shows nothing for a dropped prep step, or on a step with none', () => {
    expect(render([prep({ status: 'dropped' }), apply])).not.toContain('Dash is preparing');
    const plain = render([apply]);
    expect(plain).not.toContain('Dash is preparing');
    expect(plain).not.toContain('Dash prepared:');
  });
});
