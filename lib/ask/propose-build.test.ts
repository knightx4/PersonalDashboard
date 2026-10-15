import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlanData, PlanItem } from '@/lib/plan/load';
import type { LastRun } from '@/lib/plan/run-end';
import type { DashChange, NewDashChange } from '@/lib/talk/changes';
import type { SchemaClient } from './db';

/**
 * propose_build (plan #2106.1): Ask Dash asked to build a plan step proposes
 * a card, and a step the plan page's Send would refuse gets that refusal in
 * words and no card. The refusals are the real ones (checkStepSend in
 * lib/plan/handover.ts), over a plan and runs held in memory.
 */

const plan: { data: PlanData; runs: Record<string, LastRun> } = { data: { items: [], dependencies: [] }, runs: {} };
const started: string[] = [];

vi.mock('@/lib/plan/load', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/plan/load')>()),
  loadPlan: vi.fn(async () => plan.data),
}));
vi.mock('@/lib/plan/runs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/plan/runs')>()),
  loadLastRuns: vi.fn(async () => plan.runs),
  reshapeUnderway: vi.fn(async () => false),
  endRunsOnStep: vi.fn(async () => undefined),
  startRoutineRun: vi.fn(async (input: { text: string }) => {
    started.push(input.text);
    return { ok: true, detail: 'Started.' };
  }),
}));

import { executeProposal, type ProposeContext } from './propose';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = Date.parse('2026-10-15T12:00:00Z');
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

function item(over: Partial<PlanItem> & { id: string; number: number; title: string }): PlanItem {
  return {
    module: null,
    parentId: null,
    detail: null,
    acceptance: null,
    status: 'not_started',
    kind: 'build',
    track: 'feature',
    resolution: null,
    dismissedAt: null,
    comment: null,
    blockAsk: null,
    blockKind: null,
    thread: [],
    priority: 2,
    size: null,
    assignee: null,
    commitSha: null,
    position: over.number,
    startedAt: null,
    completedAt: null,
    createdAt: '2026-10-01T09:00:00Z',
    updatedAt: '2026-10-01T09:00:00Z',
    ...over,
  };
}

const FEATURE = id(1);
const STEP = id(2);
const OTHER = id(3);

function context(opts: { enabled?: ProposeContext['enabledModules']; seen?: string[] } = {}) {
  const writes: string[] = [];
  const kept: NewDashChange[] = [];
  // Any write here would be the check starting something: none is allowed.
  const client = {
    from: (table: string) => {
      const query: Record<string, unknown> = {};
      for (const name of ['select', 'eq', 'is', 'not', 'order', 'limit']) query[name] = () => query;
      for (const op of ['insert', 'update', 'delete', 'upsert']) query[op] = () => (writes.push(`${op} ${table}`), query);
      query.then = (resolve: (value: unknown) => void) => resolve({ data: [], error: null });
      return query;
    },
  } as unknown as SchemaClient;
  const seen = new Set(opts.seen ?? [STEP]);
  const ctx: ProposeContext = {
    userId: 'u',
    today: '2026-10-15',
    enabledModules: opts.enabled ?? ['dev'],
    db: async () => client,
    searchSources: [],
    now: NOW,
    seen: (table, ref) => table === 'public.plan_items' && seen.has(ref),
    save: async (change) => {
      kept.push(change);
      return { ...change, id: 'c1', status: 'proposed' } as DashChange;
    },
  };
  return { ctx, writes, kept };
}

function steps(step: Partial<PlanItem> = {}, other: Partial<PlanItem> = {}) {
  plan.data = {
    items: [
      item({ id: FEATURE, number: 2106, title: 'Let Ask Dash start a build session on a plan step' }),
      item({ id: STEP, number: 2110, title: 'Show a Confirm card', parentId: FEATURE, ...step }),
      item({ id: OTHER, number: 2111, title: 'Start the session', parentId: FEATURE, ...other }),
    ],
    dependencies: [],
  };
}

beforeEach(() => {
  started.length = 0;
  plan.runs = {};
  steps();
});

describe('propose_build', () => {
  it('keeps a card naming the step by outline and title, and starts nothing', async () => {
    const { ctx, writes, kept } = context();
    const result = await executeProposal('propose_build', { step_ref: STEP }, ctx);
    expect(result.ok).toBe(true);
    expect(kept).toEqual([
      {
        kind: 'start_build',
        input: { stepId: STEP, number: 2110, outline: '2106.1', title: 'Show a Confirm card', quiet: false },
      },
    ]);
    if (result.ok) expect(result.note).toMatch(/#2106\.1 "Show a Confirm card".*cannot be undone/);
    expect(writes).toEqual([]);
    expect(started).toEqual([]);
  });

  it('refuses a step no lookup returned', async () => {
    const { ctx, kept } = context({ seen: [] });
    const result = await executeProposal('propose_build', { step_ref: STEP }, ctx);
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/No lookup/) });
    expect(kept).toEqual([]);
  });

  it('refuses with the Dev workspace off', async () => {
    const { ctx, kept } = context({ enabled: ['todo'] });
    const result = await executeProposal('propose_build', { step_ref: STEP }, ctx);
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/Dev workspace is switched off/) });
    expect(kept).toEqual([]);
  });

  it.each<[string, Partial<PlanItem>, Partial<PlanItem>, RegExp]>([
    ['a proposal', { status: 'proposed' }, {}, /only a proposal\. Approve it first/],
    ['a question', { kind: 'decision' }, {}, /is a question/],
    ['a blocked step', { status: 'blocked', blockAsk: 'Which shape?' }, {}, /#2106\.1/],
    ['a feature with a live session', {}, { status: 'in_progress', startedAt: ago(5) }, /#2106\.2/],
    ['a step already underway', { status: 'in_progress', startedAt: ago(5) }, {}, /already underway/],
    ['a closed step', { status: 'done' }, {}, /done already/],
  ])('refuses %s in words, and keeps no card', async (_, step, other, error) => {
    steps(step, other);
    const { ctx, writes, kept } = context();
    const result = await executeProposal('propose_build', { step_ref: STEP }, ctx);
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(error) });
    expect(kept).toEqual([]);
    expect(writes).toEqual([]);
  });

  it('proposes a step whose run has gone quiet, and says confirming writes that run off', async () => {
    steps({ status: 'in_progress', startedAt: ago(60) });
    plan.runs = {
      [STEP]: {
        status: 'started',
        createdAt: ago(60),
        error: null,
        job: 'step',
        reading: { checkedAt: ago(1), lastPush: { at: ago(30), sha: null, subject: null }, refusal: null },
      } as LastRun,
    };
    const { ctx, kept } = context();
    const result = await executeProposal('propose_build', { step_ref: STEP }, ctx);
    expect(result.ok).toBe(true);
    expect(kept[0]).toMatchObject({ kind: 'start_build', input: { quiet: true } });
    if (result.ok) expect(result.note).toMatch(/gone quiet/);
  });
});
