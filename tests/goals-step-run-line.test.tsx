/**
 * A sent step's run on its row after a reload (plan #1044).
 *
 * The goal page reads the latest run on each step sent, prepared or asked
 * about from its row, and the row says what that run is on now while it goes,
 * then why it failed or what it said it did.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildForest, type Step } from '@/lib/goals/steps';
import { stepRunViews, type GoalRun } from '@/lib/goals/shaping';
import type { GoalMap } from '@/lib/goals/steps-store';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/goals/goal-debt',
  useSearchParams: () => new URLSearchParams(),
}));

const { StepTree } = await import('@/app/goals/[goalId]/step-tree');

const GOAL = 'goal-debt';
const NOW = Date.parse('2026-09-25T12:00:00Z');

function step(id: string, extra: Partial<Step> & { title: string }): Step {
  return {
    id,
    parentId: GOAL,
    kind: 'claude',
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

const forest = buildForest(
  [GOAL],
  [
    step('draft', { title: 'Draft the letter to Edfinancial', position: 10 }),
    step('compare', { title: 'Compare the repayment plans', position: 20 }),
    step('rates', { title: 'Find the current rates', position: 30 }),
    step('untouched', { title: 'List every balance', position: 40 }),
  ],
);

const map: GoalMap = {
  goal: {
    id: GOAL,
    areaId: 'money',
    title: 'Pay off the student loans',
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
  threads: {},
};

function run(extra: Partial<GoalRun>): GoalRun {
  return {
    id: 'run',
    status: 'started',
    createdAt: '2026-09-25T11:50:00Z',
    endedAt: null,
    summary: null,
    error: null,
    lastSeenAt: null,
    nowOn: null,
    ...extra,
  };
}

const runs = stepRunViews(
  {
    draft: run({
      id: 'run-draft',
      lastSeenAt: '2026-09-25T11:57:00Z',
      nowOn: 'Reading the loan statements',
    }),
    compare: run({
      id: 'run-compare',
      status: 'failed',
      endedAt: '2026-09-25T11:55:00Z',
      error: 'The statements were not in the vault.',
    }),
    rates: run({
      id: 'run-rates',
      status: 'done',
      endedAt: '2026-09-25T11:58:00Z',
      summary: 'Wrote the three current rates into the result.',
    }),
  },
  NOW,
);

const html = renderToStaticMarkup(<StepTree map={map} todoOn={false} runs={runs} />);

/** The markup of one step's row, from its anchor to the next step's. */
function rowOf(id: string, next: string | null): string {
  const start = html.indexOf(`step-${id}`);
  const end = next ? html.indexOf(`step-${next}`) : html.length;
  expect(start).toBeGreaterThan(-1);
  return html.slice(start, end);
}

describe('a sent step read with the page', () => {
  it('shows a running run and what it is on now', () => {
    const row = rowOf('draft', 'compare');
    expect(row).toContain('Claude is on this');
    expect(row).toContain('on Reading the loan statements, 3 minutes ago');
    expect(row).toContain('/goals/runs/run-draft');
  });

  it('shows why a failed run stopped', () => {
    const row = rowOf('compare', 'rates');
    expect(row).toContain('The last run did not finish: The statements were not in the vault.');
    expect(row).toContain('/goals/runs/run-compare');
  });

  it('shows what a finished run did', () => {
    const row = rowOf('rates', 'untouched');
    expect(row).toContain('Wrote the three current rates into the result.');
    expect(row).not.toContain('Claude is on this');
  });

  it('says nothing on a step no run was on', () => {
    const row = rowOf('untouched', null);
    expect(row).not.toContain('Claude is on this');
    expect(row).not.toContain('Last run');
    expect(row).not.toContain('did not finish');
  });

  it('reads a run gone quiet as failed, with where it stopped', () => {
    const quiet = stepRunViews(
      {
        draft: run({
          createdAt: '2026-09-25T10:50:00Z',
          lastSeenAt: '2026-09-25T11:00:00Z',
          nowOn: 'Reading the loan statements',
        }),
      },
      NOW,
    );
    expect(quiet.draft.running).toBeNull();
    expect(quiet.draft.error).toContain('while on Reading the loan statements');
  });
});
