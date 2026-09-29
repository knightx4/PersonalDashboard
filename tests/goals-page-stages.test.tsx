/**
 * The goal page opens on the work in hand (plan #1078). A goal in stages is
 * one card like any other (note 014bae50), opened on the Open view in place of
 * the folded stages (note 9e8cd196), and a goal that is one list folds its
 * finished steps under the open ones.
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
        step('update', { title: 'Update your resume', parentId: 'resume' }),
      ])}
      todoOn={false}
    />,
  );

  it('draws every stage in the one steps card, with no stage headings', () => {
    expect(html).not.toContain('Stage 2 of 3');
    expect(html).not.toContain('Other stages');
    expect(html.match(/>Steps<\/h2>/g)).toHaveLength(1);
    expect(html).toContain('Know the job you are aiming for');
    expect(html).toContain('Settle your pay floor');
    expect(html).toContain('Resume ready to send');
  });

  it('opens on Open, leaving the finished stage out until Everything is chosen', () => {
    expect(html).not.toContain('Walk into interviews ready');
    const current = [
      ...html.matchAll(/<a[^>]*aria-current="page"[^>]*>([\s\S]*?)<\/a>/g),
    ].map((m) => m[1]!.replace(/<[^>]+>/g, '').trim());
    expect(current).toEqual([expect.stringMatching(/^Open/)]);
  });
});

describe('a goal that is one list', () => {
  it('folds its finished steps under the open ones on Everything', () => {
    const html = renderToStaticMarkup(
      <StepTree
        map={mapOf([
          step('list', { title: 'List every balance', status: 'done', position: 10 }),
          step('call', { title: 'Call the card company', position: 20 }),
        ])}
        todoOn={false}
        view="all"
      />,
    );
    expect(folds(html)).toContainEqual({ open: false, text: 'Finished 1' });
    expect(html.indexOf('Call the card company')).toBeLessThan(html.indexOf('List every balance'));
  });
});

describe('the view chips on a goal (plan #1157)', () => {
  const map = mapOf([
    step('list', { title: 'List every balance', status: 'done', position: 10 }),
    step('call', { title: 'Call the card company', position: 20 }),
    step('research', {
      title: 'Find the repayment plans',
      kind: 'claude',
      position: 30,
    }),
    step('plan', { title: 'Which plan suits you?', kind: 'decision', position: 40 }),
  ]);
  const titles = (html: string) =>
    ['List every balance', 'Call the card company', 'Find the repayment plans', 'Which plan suits you?'].filter(
      (title) => html.includes(title),
    );
  const chips = (html: string) =>
    [...html.matchAll(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)]
      .map((m) => [m[2]!.replace(/<[^>]+>/g, '').trim(), m[1]!] as const)
      .filter(([label]) => /^(Open|On you|Everything)/.test(label));

  it('draws Open, On you and Everything as links to ?view=, Open on the bare path', () => {
    const html = renderToStaticMarkup(<StepTree map={map} todoOn={false} />);
    expect(chips(html).map(([label, href]) => [label.replace(/ \d+$/, ''), href])).toEqual([
      ['Open', '/goals/goal-role'],
      ['On you', '/goals/goal-role?view=you'],
      ['Everything', '/goals/goal-role?view=all'],
    ]);
  });

  it('opens on Open, which leaves the done step out', () => {
    const html = renderToStaticMarkup(<StepTree map={map} todoOn={false} />);
    expect(titles(html)).toEqual([
      'Call the card company',
      'Find the repayment plans',
      'Which plan suits you?',
    ]);
  });

  it('On you shows only your step and the question, not the step for Dash', () => {
    const html = renderToStaticMarkup(<StepTree map={map} todoOn={false} view="you" />);
    expect(titles(html)).toEqual(['Call the card company', 'Which plan suits you?']);
  });

  it('Everything shows the done step too', () => {
    const html = renderToStaticMarkup(<StepTree map={map} todoOn={false} view="all" />);
    expect(titles(html)).toEqual([
      'List every balance',
      'Call the card company',
      'Find the repayment plans',
      'Which plan suits you?',
    ]);
  });
});
