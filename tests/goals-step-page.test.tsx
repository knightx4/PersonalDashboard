/**
 * A step's own page (plan #1620), at /goals/<goal>/s/<step>: the step's row
 * from the goal page, opened, with its title as the page's heading, its
 * sub-steps beneath, and each sub-step reachable on a page of its own. Above
 * it, the path from Goals through the area, the goal and every step it sits
 * under (plan #1622). On the page, a date that is
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
const { titleHead, titleTail } = await import('@/components/plan-tree/tree-row');

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
  it('draws the step as the heading, opened, with its sub-steps and the path back up', () => {
    const html = renderToStaticMarkup(<StepPage map={map} stepId="rates" todoOn={false} />);
    expect(text(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)![1]!)).toBe('Get the rates lowered');
    expect(html).toContain(`href="/goals/${GOAL}"`);
    expect(text(html)).toContain('Call each lender.');
    // The sub-steps are on their own tab (plan #2373.2), not under the panel.
    expect(text(html)).not.toContain('Compare the transfer fees');
    // The page links to itself twice: the path's last part, and the Overview
    // tab, which is the plain address (plan #2373.1). The row does not.
    expect(html.split(`href="/goals/${GOAL}/s/rates"`)).toHaveLength(3);
    expect(text(html)).toContain('Sub-steps');
    expect(text(html)).toContain('Activity');
    expect(html).toMatch(new RegExp(`aria-current="page"[^>]*href="/goals/${GOAL}/s/rates"`));
    expect(text(html.match(/<nav aria-label="Breadcrumb"[\s\S]*?<\/nav>/)![0])).toBe(
      'Goals › … › Money › Pay off the credit cards › Get the rates lowered',
    );
    // A step elsewhere on the goal is not on this page.
    expect(text(html)).not.toContain('Move the balance');
  });

  it("names every step a sub-step sits under in its path, linked to that step's page", () => {
    const html = renderToStaticMarkup(<StepPage map={map} stepId="call" todoOn={false} />);
    expect(text(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)![1]!)).toBe('Call the card company');
    const path = html.match(/<nav aria-label="Breadcrumb"[\s\S]*?<\/nav>/)![0];
    expect(text(path)).toBe(
      'Goals › … › Money › Pay off the credit cards › Get the rates lowered › Call the card company',
    );
    expect(path).toContain(`href="/goals/${GOAL}/s/rates"`);
    expect(path).toContain('href="/goals/area/money"');
  });

  it('reads a set date as text and keeps the unset ones behind one add control', () => {
    const html = renderToStaticMarkup(<StepPage map={map} stepId="call" todoOn={false} />);
    expect(text(html)).toContain('Due 3 Oct');
    expect(text(html)).toContain('Dates and amount');
    expect(html).not.toContain('type="date"');
    // The values still go with the form, so saving one fact keeps the others.
    expect(html).toContain('name="dueOn" value="2026-10-03"');
  });

  it('puts every part of the panel on one tab (plan #2373.2)', () => {
    const page = (stepId: string, tab: 'overview' | 'substeps' | 'activity') =>
      text(renderToStaticMarkup(<StepPage map={map} stepId={stepId} todoOn={false} tab={tab} />));
    const runs = {
      rates: { runId: 'r1', running: null, error: null, summary: 'Wrote the call script.' },
    };

    // Overview: the detail, and neither the sub-steps, the thread nor the run.
    const overview = page('rates', 'overview');
    expect(overview).toContain('Call each lender.');
    expect(overview).not.toContain('Call the card company');
    expect(overview).not.toContain('Add a comment');

    // Sub-steps: the open sub-steps under the goal page's columns, then the composer.
    const substeps = page('rates', 'substeps');
    expect(substeps).toContain('Call the card company');
    expect(substeps).toContain('Compare the transfer fees');
    expect(substeps).toContain('Add a sub-step');
    expect(substeps).not.toContain('Call each lender.');
    expect(substeps).not.toContain('Add a comment');

    // A step with none says so, and offers to add the first.
    const none = page('call', 'substeps');
    expect(none).toContain('No sub-steps yet');
    expect(none).toContain('Add a sub-step');

    // Activity: the run and the thread, and not the panel.
    const activity = text(
      renderToStaticMarkup(
        <StepPage map={map} stepId="rates" todoOn={false} tab="activity" runs={runs} />,
      ),
    );
    expect(activity).toContain('Wrote the call script.');
    expect(activity).toContain('Comment on this step');
    expect(activity).not.toContain('Call each lender.');
    expect(activity).not.toContain('Call the card company');
    expect(page('rates', 'activity')).toContain('Dash has not run on this step yet.');

    // The run line is on Activity alone.
    expect(
      text(
        renderToStaticMarkup(
          <StepPage map={map} stepId="rates" todoOn={false} tab="overview" runs={runs} />,
        ),
      ),
    ).not.toContain('Wrote the call script.');
  });

  it('lists only the facts the step has, and its runs as the goal lists its own (plan #2373.3)', () => {
    // Get the rates lowered has no due date and waits on nothing: neither is said as a dash.
    const facts = text(renderToStaticMarkup(<StepPage map={map} stepId="rates" todoOn={false} />));
    expect(facts).toContain('Progress');
    expect(facts).not.toContain('—');
    expect(facts).not.toContain('Waiting on');
    // Call the card company has one, and says it.
    expect(text(renderToStaticMarkup(<StepPage map={map} stepId="call" todoOn={false} />))).toContain(
      'Due 3 Oct',
    );

    const history = {
      runs: [
        { id: 'r1', label: 'Sent a step', meta: 'Finished · took 4 min', failed: false, text: 'Wrote the call script.' },
      ],
      more: true,
    };
    const activity = renderToStaticMarkup(
      <StepPage map={map} stepId="rates" todoOn={false} tab="activity" history={history} />,
    );
    expect(text(activity)).toContain('Sent a step · Finished · took 4 min');
    expect(text(activity)).toContain('Wrote the call script.');
    expect(activity).toContain('href="/goals/runs/r1"');
    expect(text(activity)).toContain('All runs');
  });

  it('draws nothing for a step the goal does not hold', () => {
    expect(renderToStaticMarkup(<StepPage map={map} stepId="nope" todoOn={false} />)).toBe('');
  });
});

describe('the heading keeps its marks on the title’s last line (plan #1623)', () => {
  it('glues the last word to what follows it, and leaves the rest free to wrap', () => {
    expect(titleTail('Draft what to say on the call')).toBe('call');
    expect(titleHead('Draft what to say on the call')).toBe('Draft what to say on the ');
    expect(titleTail('Call')).toBe('Call');
    expect(titleHead('Call')).toBe('');
  });

  it('does not glue a word too long to keep whole on a phone', () => {
    const long = 'Read https://example.com/a-very-long-address-that-runs-on';
    expect(titleTail(long)).toBe('');
    expect(titleHead(long)).toBe(long);
  });
});
