import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlanData, PlanItem } from './load';

const plan: { data: PlanData } = { data: { items: [], dependencies: [] } };
const started: string[] = [];

vi.mock('./load', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./load')>()),
  loadPlan: vi.fn(async () => plan.data),
}));
vi.mock('./runs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./runs')>()),
  loadLastRuns: vi.fn(async () => ({})),
  reshapeUnderway: vi.fn(async () => false),
  endRunsOnStep: vi.fn(async () => undefined),
  startRoutineRun: vi.fn(async (input: { text: string }) => {
    started.push(input.text);
    return { ok: true, detail: 'Started.' };
  }),
}));
vi.mock('@/lib/specs/vision', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/specs/vision')>()),
  loadVisionBodies: vi.fn(async () => ({})),
}));

import { handFeatureToClaude, handStepToClaude } from './handover';

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

// Every write the press makes resolves with no error.
const chain: Record<string, unknown> = {};
for (const name of ['from', 'update', 'eq']) chain[name] = () => chain;
chain.then = (resolve: (value: { error: null }) => void) => resolve({ error: null });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabase = chain as any;

beforeEach(() => {
  started.length = 0;
  plan.data = {
    items: [
      item({ id: 'f', number: 1073, title: 'Feature' }),
      item({ id: 'a', number: 1080, title: 'First', parentId: 'f' }),
      item({ id: 'b', number: 1084, title: 'The step', parentId: 'f' }),
      item({ id: 'p', number: 1090, title: 'An idea', parentId: 'f', status: 'proposed' }),
    ],
    dependencies: [],
  };
});

describe('handing a step to a session', () => {
  it('names the step by its outline, so the session says it back the way the page reads', async () => {
    const sent = await handStepToClaude({ supabase, userId: 'u', id: 'b' });
    expect(sent).toMatchObject({ ok: true, number: 1084, outline: '1073.2' });
    expect(started[0]).toMatch(/^Build plan step #1073\.2, "The step"/);
    expect(started[0]).not.toContain('#1084');
  });

  it('refuses a proposal by its outline', async () => {
    const sent = await handStepToClaude({ supabase, userId: 'u', id: 'p' });
    expect(sent).toEqual({ ok: false, error: '#1073.3 is only a proposal. Approve it first.' });
  });

  it('names a feature by its outline too', async () => {
    const sent = await handFeatureToClaude({ supabase, userId: 'u', id: 'f' });
    expect(sent).toMatchObject({ ok: true, outline: '1073' });
    expect(started[0]).toMatch(/^Work plan feature #1073, "Feature"/);
  });
});
