/**
 * "Dash is on it" on a goal step while its run is going (plan #1455).
 *
 * Send on a step writes one started row in goals.runs (goals-send-step.test.ts
 * covers that write). Here the run is stubbed: a stand-in client answers the
 * page's read of the steps' runs with the row the press wrote, and then with
 * the same row once the run has ended. The step says "Dash is on it" between
 * the two, and keeps its Who column throughout.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { buildForest, type Step } from '@/lib/goals/steps';
import { stepRunViews } from '@/lib/goals/shaping';
import { loadStepRuns } from '@/lib/goals/shaping-store';
import type { GoalMap } from '@/lib/goals/steps-store';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/goals/goal-debt',
  useSearchParams: () => new URLSearchParams(),
}));

const { StepTree } = await import('@/app/goals/[goalId]/step-tree');

const GOAL = 'goal-debt';
const NOW = Date.parse('2026-10-03T12:00:00Z');

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
    step('other', { title: 'List every balance', position: 20 }),
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
  answers: {},
  threads: {},
};

/** A stand-in for the page's read of goals.runs, answering with these rows. */
function stubRuns(rows: Record<string, unknown>[]): GoalsSupabaseClient {
  const builder = {
    select: () => builder,
    in: () => builder,
    order: () => builder,
    limit: () => Promise.resolve({ data: rows, error: null }),
  };
  return { from: () => builder } as unknown as GoalsSupabaseClient;
}

/** The run row Send writes for the step, as it stands at each point. */
function sentRun(extra: Record<string, unknown> = {}) {
  return {
    id: 'run-draft',
    item_id: 'draft',
    status: 'started',
    created_at: '2026-10-03T11:58:00Z',
    ended_at: null,
    summary: null,
    error: null,
    last_seen_at: '2026-10-03T11:59:00Z',
    now_on: 'Reading the loan statements',
    ...extra,
  };
}

/** The goal page as it reads after a reload, with the runs the stub holds. */
async function pageWith(rows: Record<string, unknown>[]) {
  const runs = await loadStepRuns(stubRuns(rows), ['draft', 'other']);
  return renderToStaticMarkup(
    <StepTree map={map} todoOn={false} runs={stepRunViews(runs, NOW)} />,
  );
}

function rowOf(html: string, id: string, next: string | null): string {
  const start = html.indexOf(`step-${id}`);
  const end = next ? html.indexOf(`step-${next}`) : html.length;
  expect(start).toBeGreaterThan(-1);
  return html.slice(start, end);
}

describe('a goal step sent to Dash from its button', () => {
  it('offers Send and says nothing of a run before the press', async () => {
    const row = rowOf(await pageWith([]), 'draft', 'other');
    expect(row).toContain('Send to Dash');
    expect(row).not.toContain('Dash is on it');
  });

  it('says Dash is on it while the run the press started is going', async () => {
    const html = await pageWith([sentRun()]);
    const row = rowOf(html, 'draft', 'other');
    expect(row).toContain('Dash is on it');
    expect(row).toContain('on Reading the loan statements');
    expect(row).toContain('/goals/runs/run-draft');
    // The Who column stays: who the step is on is a different fact.
    expect(row).toContain('>Dash<');
    // Only the step the run is on.
    expect(rowOf(html, 'other', null)).not.toContain('Dash is on it');
  });

  it('stops once the run ends', async () => {
    const done = rowOf(
      await pageWith([sentRun({ status: 'done', ended_at: '2026-10-03T12:00:00Z', summary: 'Drafted it.' })]),
      'draft',
      'other',
    );
    expect(done).not.toContain('Dash is on it');
    expect(done).toContain('Drafted it.');

    const failed = rowOf(
      await pageWith([sentRun({ status: 'failed', ended_at: '2026-10-03T12:00:00Z', error: 'No statements.' })]),
      'draft',
      'other',
    );
    expect(failed).not.toContain('Dash is on it');
  });

  it('stops once the run has gone quiet, before the sweep closes it', async () => {
    const quiet = rowOf(
      await pageWith([
        sentRun({ created_at: '2026-10-03T10:00:00Z', last_seen_at: '2026-10-03T10:05:00Z' }),
      ]),
      'draft',
      'other',
    );
    expect(quiet).not.toContain('Dash is on it');
  });
});
