import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Approving a spec change starts the run that writes it into the spec and
 * shapes it (plan #1509): one plan routine run, job `spec_change`, about no
 * step, carrying the diff placed against the spec. A diff that no longer fits
 * the spec is refused before anything is decided, and a run that does not
 * start puts the change back to proposed.
 */

const SPEC = ['# Specs', '', '## Part 3', '', 'First rule.', ''].join('\n');

const state = vi.hoisted(() => ({
  change: null as null | Record<string, unknown>,
  decided: [] as string[],
  reopened: [] as string[],
  runs: [] as { job: string; planItemId?: string | null; text?: string | null }[],
  fire: { ok: true, detail: 'started', runId: 'run-1' } as Record<string, unknown>,
  spec: '' as string | null,
}));

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/lib/auth/server', () => ({ createClient: async () => ({}) }));
vi.mock('@/lib/dev/owner', () => ({ requireOwner: async () => ({ id: 'owner' }) }));
vi.mock('@/lib/specs/registry', () => ({
  specBySlug: (slug: string) => (slug === 'spec-layer' ? { slug, file: 'SPEC-LAYER-SPEC.md' } : null),
  readSpec: async () => state.spec,
}));
vi.mock('@/lib/specs/changes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/specs/changes')>()),
  loadSpecChange: async () => state.change,
  decideSpecChange: async (_db: unknown, _user: string, id: string, decision: string) => {
    state.decided.push(decision);
    return { change: { ...state.change, id, status: decision, thread: [] } };
  },
  reopenSpecChange: async (_db: unknown, _user: string, id: string) => {
    state.reopened.push(id);
  },
}));
vi.mock('@/lib/feedback/routine', () => ({ planRoutine: () => ({ id: 'trig', token: 'tok' }) }));
vi.mock('@/lib/plan/runs', () => ({
  startRoutineRun: async (input: { job: string; planItemId?: string | null; text?: string | null }) => {
    state.runs.push({ job: input.job, planItemId: input.planItemId, text: input.text });
    return state.fire;
  },
}));

const { approveSpecChange, declineSpecChange } = await import('@/app/dev/specs/actions');

const ID = '00000000-0000-4000-8000-000000000001';
function form() {
  const data = new FormData();
  data.set('id', ID);
  return data;
}

beforeEach(() => {
  state.change = {
    id: ID,
    spec: 'spec-layer',
    title: 'Every spec names its counts',
    why: 'Three notes ask for it.',
    diff: '@@ -40 +40,2 @@\n First rule.\n+Second rule.\n',
    status: 'proposed',
    madeBy: 'claude',
  };
  state.decided = [];
  state.reopened = [];
  state.runs = [];
  state.fire = { ok: true, detail: 'started', runId: 'run-1' };
  state.spec = SPEC;
});

describe('approveSpecChange', () => {
  it('approves and starts one spec_change run, about no step, with the diff placed', async () => {
    const result = await approveSpecChange({}, form());
    expect(state.decided).toEqual(['approved']);
    expect(state.runs).toHaveLength(1);
    expect(state.runs[0].job).toBe('spec_change');
    expect(state.runs[0].planItemId ?? null).toBeNull();
    expect(state.runs[0].text).toContain('docs/SPEC-LAYER-SPEC.md');
    expect(state.runs[0].text).toContain('@@ -5 +5,2 @@');
    expect(result.message).toMatch(/^Approved\. Dash is writing it into the spec/);
  });

  it('refuses a diff whose lines are no longer in the spec, deciding nothing', async () => {
    state.change = { ...state.change, diff: '@@ @@\n-A rule nobody wrote.\n+Something.\n' };
    const result = await approveSpecChange({}, form());
    expect(result.error).toMatch(/no longer fits the spec/);
    expect(state.decided).toEqual([]);
    expect(state.runs).toEqual([]);
  });

  it('puts the change back to proposed when the run does not start', async () => {
    state.fire = { ok: false, error: 'CLAUDE_PLAN_ROUTINE_ID is not set', status: null };
    const result = await approveSpecChange({}, form());
    expect(state.reopened).toEqual([ID]);
    expect(result.error).toBe(
      'Not approved: Dash could not start writing it into the spec. CLAUDE_PLAN_ROUTINE_ID is not set',
    );
  });

  it('starts nothing for a change already decided', async () => {
    state.change = { ...state.change, status: 'approved' };
    const result = await approveSpecChange({}, form());
    expect(result.error).toBe('That change has already been decided.');
    expect(state.runs).toEqual([]);
  });
});

describe('declineSpecChange', () => {
  it('starts no run', async () => {
    const result = await declineSpecChange({}, form());
    expect(state.decided).toEqual(['declined']);
    expect(state.runs).toEqual([]);
    expect(result.message).toBe('Declined.');
  });
});
