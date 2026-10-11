/**
 * The goal page opens on the work in hand (plan #1078). A goal in stages
 * draws the stages `nowStages` opens under Now, unfolded, and every other
 * stage under Other stages as one folded line saying how far along it is. A
 * goal that is one list is Now alone, its finished steps folded under the
 * open ones. There are no view chips, column header or tally.
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

/** The text of the section with this heading id, tags stripped. */
function section(html: string, id: string): string {
  const start = html.indexOf(`id="${id}"`);
  if (start < 0) return '';
  const end = html.indexOf('</section>', start);
  return html
    .slice(start, end)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
}

describe('a goal in stages', () => {
  const html = renderToStaticMarkup(
    <StepTree
      map={mapOf([
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
        step('network', { title: 'Build the network', position: 30 }),
        step('coffee', { title: 'Book three coffees', parentId: 'network' }),
      ])}
      todoOn={false}
    />,
  );
  const now = section(html, 'now-heading');
  const map = section(html, 'map-heading');

  it('opens the first stage in hand and any stage with a step of yours ready under Now', () => {
    expect(now).toContain('Stages 2 and 4 of 4');
    expect(now).toContain('Know the job you are aiming for');
    expect(now).toContain('Settle your pay floor');
    expect(now).toContain('Build the network');
    expect(now).toContain('Book three coffees');
    expect(now).not.toContain('Resume ready to send');
  });

  it('folds a finished step in an open stage under Finished', () => {
    expect(folds(html)).toContainEqual({ open: false, text: 'Finished 1' });
    // Its rows are drawn once the fold is opened.
    expect(now).not.toContain('See where your search got traction');
  });

  it('draws every other stage on the map as one line, folded, saying how far along it is', () => {
    expect(map).toContain('Walk into interviews ready');
    expect(map).toContain('done');
    expect(map).toContain('Resume ready to send');
    expect(map).toContain('1 step');
    expect(map).not.toContain('Update your resume');
    expect(map).not.toContain('Draft five answers');
  });

  it('has no view chips, column header or tally', () => {
    expect(html).not.toContain('aria-current="page"');
    expect(html).not.toMatch(/>Who</);
    expect(html).not.toContain('Everything');
  });
});

describe('a goal that is one list', () => {
  it('is Now alone, its finished steps folded under the open ones', () => {
    const html = renderToStaticMarkup(
      <StepTree
        map={mapOf([
          step('list', { title: 'List every balance', status: 'done', position: 10 }),
          step('call', { title: 'Call the card company', position: 20 }),
        ])}
        todoOn={false}
      />,
    );
    expect(html).not.toContain('map-heading');
    expect(folds(html)).toContainEqual({ open: false, text: 'Finished 1' });
    expect(html).toContain('Call the card company');
    expect(html).not.toContain('List every balance');
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
      />,
    );
    const now = section(html, 'now-heading');
    expect(now).toContain('Find the repayment plans');
    expect(folds(html)).toContainEqual({
      open: false,
      text: 'Dash found · new : Three plans fit.',
    });
    expect(html).not.toContain('Finished');
  });
});
