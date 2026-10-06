/**
 * A step's own page (plan #1620), at /goals/<goal>/s/<step>: the step's row
 * from the goal page, opened, with its title as the page's heading, its
 * sub-steps beneath, and each sub-step reachable on a page of its own. A
 * sub-step's page names the step it sits under. On the page, a date that is
 * set reads as text and the unset ones wait behind one add control.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildForest, type Step } from '@/lib/goals/steps';
import type { GoalMap } from '@/lib/goals/steps-store';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/goals/goal-debt/s/rates',
  useSearchParams: () => new URLSearchParams(),
}));

const { StepPage } = await import('@/app/goals/[goalId]/step-page');

const GOAL = 'goal-debt';

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

const steps = [
  step('rates', GOAL, { title: 'Get the rates lowered', detail: 'Call each lender.' }),
  step('call', 'rates', { title: 'Call the card company', dueOn: '2026-10-03', position: 10 }),
  step('fees', 'rates', { title: 'Compare the transfer fees', position: 20 }),
  step('move', GOAL, { title: 'Move the balance', position: 20 }),
];

const forest = buildForest([GOAL], steps);
const map: GoalMap = {
  goal: {
    id: GOAL,
    areaId: 'money',
    title: 'Pay off the credit cards',
    acceptance: null,
    fog: null,
    status: 'open',
    position: 10,
    unit: null,
    target: null,
  },
  areaName: 'Money',
  steps: forest.byGoal.get(GOAL) ?? [],
  linked: [],
  otherGoals: [],
  linksOf: {},
  rhythms: {},
  information: {},
  answers: {},
  threads: {},
};

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('StepPage', () => {
  it('draws the step as the heading, opened, with its sub-steps and a way back to the goal', () => {
    const html = renderToStaticMarkup(<StepPage map={map} stepId="rates" todoOn={false} />);
    expect(text(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)![1]!)).toBe('Get the rates lowered');
    expect(html).toContain(`href="/goals/${GOAL}"`);
    expect(text(html)).toContain('Call each lender.');
    expect(text(html)).toContain('Call the card company');
    expect(text(html)).toContain('Compare the transfer fees');
    // The page's own step does not link to the page it is on.
    expect(html).not.toContain(`href="/goals/${GOAL}/s/rates"`);
    // A step elsewhere on the goal is not on this page.
    expect(text(html)).not.toContain('Move the balance');
  });

  it("names the step a sub-step sits under, linked to that step's page", () => {
    const html = renderToStaticMarkup(<StepPage map={map} stepId="call" todoOn={false} />);
    expect(text(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)![1]!)).toBe('Call the card company');
    expect(text(html)).toContain('A sub-step of Get the rates lowered');
    expect(html).toContain(`href="/goals/${GOAL}/s/rates"`);
  });

  it('reads a set date as text and keeps the unset ones behind one add control', () => {
    const html = renderToStaticMarkup(<StepPage map={map} stepId="call" todoOn={false} />);
    expect(text(html)).toContain('Due 3 Oct');
    expect(text(html)).toContain('Dates and amount');
    expect(html).not.toContain('type="date"');
    // The values still go with the form, so saving one fact keeps the others.
    expect(html).toContain('name="dueOn" value="2026-10-03"');
  });

  it('draws nothing for a step the goal does not hold', () => {
    expect(renderToStaticMarkup(<StepPage map={map} stepId="nope" todoOn={false} />)).toBe('');
  });
});
