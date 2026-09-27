import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Accepting a vision edit re-shapes the workspace's open features (plan #1137):
 * one routine run per accept, job `vision_reshape`, no step, and an accept
 * whose run did not start still stands and says so.
 */

const state = vi.hoisted(() => ({
  edit: null as null | { module: string; visionBody: string | null; proposedBody: string | null; status: string },
  error: null as string | null,
  sections: [] as unknown[],
  runs: [] as { job: string; planItemId?: string | null; text?: string | null }[],
  fire: { ok: true, detail: 'started', runId: 'run-1' } as Record<string, unknown>,
}));

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/lib/auth/server', () => ({ createClient: async () => ({}) }));
vi.mock('@/lib/dev/owner', () => ({ requireOwner: async () => ({ id: 'owner' }) }));
vi.mock('@/lib/specs/vision-review', () => ({
  decideVisionEdit: async () => ({ error: state.error, edit: state.edit }),
}));
vi.mock('@/lib/plan/load', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/plan/load')>()),
  loadPlan: async () => ({}),
}));
vi.mock('@/lib/plan/tree', () => ({ buildPlanTree: () => state.sections }));
vi.mock('@/lib/feedback/routine', () => ({ planRoutine: () => ({ id: 'trig', token: 'tok' }) }));
vi.mock('@/lib/plan/runs', () => ({
  startRoutineRun: async (input: { job: string; planItemId?: string | null; text?: string | null }) => {
    state.runs.push({ job: input.job, planItemId: input.planItemId, text: input.text });
    return state.fire;
  },
}));

const { acceptVisionEdit, dismissVisionEdit } = await import('@/app/dev/specs/actions');

const ID = '00000000-0000-4000-8000-000000000001';
function form() {
  const data = new FormData();
  data.set('id', ID);
  return data;
}

function feature(number: number, status: string) {
  return { id: `f${number}`, number, title: `Feature ${number}`, status, dismissedAt: null };
}

beforeEach(() => {
  state.edit = { module: 'jobs', visionBody: 'Old.', proposedBody: 'New.', status: 'accepted' };
  state.error = null;
  state.sections = [
    { module: 'jobs', nodes: [feature(1, 'not_started'), feature(2, 'done'), feature(3, 'proposed')] },
    { module: 'vault', nodes: [feature(4, 'not_started')] },
  ];
  state.runs = [];
  state.fire = { ok: true, detail: 'started', runId: 'run-1' };
});

describe('acceptVisionEdit', () => {
  it('starts one re-shape run for the workspace, about no step', async () => {
    const result = await acceptVisionEdit({}, form());
    expect(state.runs).toHaveLength(1);
    expect(state.runs[0].job).toBe('vision_reshape');
    expect(state.runs[0].planItemId ?? null).toBeNull();
    expect(state.runs[0].text).toContain('#1 Feature 1');
    expect(state.runs[0].text).toContain('#3 Feature 3');
    expect(state.runs[0].text).not.toContain('#2 Feature 2');
    expect(state.runs[0].text).not.toContain('#4 Feature 4');
    expect(result.message).toMatch(/re-reading the 2 open features in Job search/);
  });

  it('keeps the accept and says so when the run does not start', async () => {
    state.fire = { ok: false, error: 'CLAUDE_PLAN_ROUTINE_ID is not set', status: null };
    const result = await acceptVisionEdit({}, form());
    expect(result.error).toBeUndefined();
    expect(result.message).toBe(
      'Vision replaced. The re-shape of the open features in Job search did not start: CLAUDE_PLAN_ROUTINE_ID is not set',
    );
  });

  it('starts nothing when nothing is open in the workspace', async () => {
    state.edit = { module: 'news', visionBody: null, proposedBody: 'New.', status: 'accepted' };
    const result = await acceptVisionEdit({}, form());
    expect(state.runs).toEqual([]);
    expect(result.message).toMatch(/nothing to re-shape/);
  });

  it('starts nothing when the accept itself failed', async () => {
    state.error = 'No pending vision edit';
    state.edit = null;
    const result = await acceptVisionEdit({}, form());
    expect(state.runs).toEqual([]);
    expect(result.error).toBe('That edit has already been decided.');
  });
});

describe('dismissVisionEdit', () => {
  it('starts no run', async () => {
    const result = await dismissVisionEdit({}, form());
    expect(state.runs).toEqual([]);
    expect(result.message).toBe('Edit dismissed.');
  });
});
