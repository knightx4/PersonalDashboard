/**
 * A goal's Steps tab is laid out as a feature's on /dev/plan: view chips,
 * then one card of grid rows under a column header. By status, the default,
 * lists every step and sub-step once in status groups, Done folded; Tree is
 * the goal's own tree with its finished top-level steps under Finished.
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
    text: m[2]!
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  }));
}

/** The text of the markup, tags stripped. */
function text(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}

/** Each status group's heading, with its count and whether it starts open. */
function groups(html: string): { label: string; open: boolean }[] {
  return [...html.matchAll(/<button type="button" aria-expanded="(true|false)"[^>]*press press-area inline-flex[^>]*>([\s\S]*?)<\/button>/g)].map(
    (m) => ({ open: m[1] === 'true', label: text(m[2]!).trim() }),
  );
}

const STAGED = [
  step('interviews', { title: 'Walk into interviews ready', status: 'done', position: 5 }),
  step('answers', { title: 'Draft five answers', parentId: 'interviews', status: 'done' }),
  step('target', { title: 'Know the job you are aiming for', position: 10 }),
  step('traction', {
    title: 'See where your search got traction',
    parentId: 'target',
    status: 'done',
  }),
  step('floor', { title: 'Settle your pay floor', parentId: 'target', position: 20 }),
  step('resume', { title: 'Resume ready to send', position: 20 }),
  step('update', { title: 'Update your resume', parentId: 'resume', kind: 'claude' }),
];

describe('a goal’s steps by status', () => {
  const html = renderToStaticMarkup(<StepTree map={mapOf(STAGED)} todoOn={false} />);

  it('offers By status and Tree as view chips, By status the one shown', () => {
    expect(html).toMatch(/aria-current="page"[^>]*>By status</);
    expect(html).toContain('href="/goals/goal-role?tab=steps&amp;view=tree"');
  });

  it('heads the card with the plan’s columns', () => {
    expect(html).toContain('>Status<');
    expect(html).toContain('>When<');
    expect(html).toContain('>Steps<');
    expect(html).not.toContain('>Health<');
  });

  it('lists every open step once, done folded with its count', () => {
    const heads = groups(html);
    expect(heads).toContainEqual({ label: 'Done 3', open: false });
    expect(heads.filter((head) => head.open).length).toBeGreaterThan(0);
    expect(html).toContain('Settle your pay floor');
    expect(html).toContain('Update your resume');
    expect(html).not.toContain('Draft five answers');
    expect((html.match(/>Settle your pay floor</g) ?? []).length).toBe(1);
  });

  it('says which step a sub-step sits under', () => {
    expect(html).toContain('Under #2 Know the job you are aiming for');
  });

  it('draws an assignee circle on every row', () => {
    expect(html).toContain('role="img" aria-label="Dash"');
    expect(html).toContain('role="img" aria-label="You"');
  });
});

describe('a goal’s steps as a tree', () => {
  it('draws the open steps with what is beneath, and folds the finished ones', () => {
    const html = renderToStaticMarkup(
      <StepTree map={mapOf(STAGED)} todoOn={false} view="tree" />,
    );
    expect(html).toMatch(/aria-current="page"[^>]*>Tree</);
    expect(html).toContain('Know the job you are aiming for');
    expect(html).toContain('Settle your pay floor');
    expect(html).not.toContain('Walk into interviews ready');
    expect(folds(html)).toContainEqual({ open: false, text: 'Finished 1' });
  });

  it('keeps an unread result of Dash’s among the open steps, as a fold on its row', () => {
    const html = renderToStaticMarkup(
      <StepTree
        map={mapOf([
          step('research', {
            title: 'Find the repayment plans',
            kind: 'claude',
            status: 'done',
            result: 'Three plans fit. The income-based one is cheapest.',
            position: 10,
          }),
          step('call', { title: 'Call the card company', position: 20 }),
        ])}
        todoOn={false}
        view="tree"
      />,
    );
    expect(html).toContain('Find the repayment plans');
    expect(folds(html)).toContainEqual({
      open: false,
      text: 'Dash found · new : Three plans fit.',
    });
    expect(html).not.toContain('Finished');
  });
});
