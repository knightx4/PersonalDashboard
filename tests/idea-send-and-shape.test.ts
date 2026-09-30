/**
 * "Send and shape" on the header panel's Idea tab (note beadca47).
 *
 * One press saves the idea and hands it to the shaping routine. The claims are
 * that the plain Send still only saves, that the second button fires the
 * routine with the idea it just saved, and that a routine that will not start
 * still says the idea was saved rather than reading as a lost idea.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const IDEA_ID = '11111111-2222-4333-8444-555555555555';

const state = vi.hoisted(() => ({
  fired: [] as string[],
  routine: { ok: true, detail: 'started' } as { ok: boolean; detail?: string; error?: string },
}));

function fakeClient() {
  const builder: Record<string, unknown> = {};
  for (const key of ['select', 'insert', 'update', 'eq', 'in', 'order', 'limit']) {
    builder[key] = () => builder;
  }
  builder.single = async () => ({ data: { id: IDEA_ID }, error: null });
  builder.maybeSingle = async () => ({ data: { id: IDEA_ID }, error: null });
  return { from: () => builder };
}

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/lib/auth/server', () => ({ createClient: async () => fakeClient() }));
vi.mock('@/lib/dev/owner', () => ({ requireOwner: async () => ({ id: 'owner' }) }));
vi.mock('@/lib/feedback/code', () => ({ codeMatches: (given: string) => given === 'right' }));
vi.mock('@/lib/feedback/routine', () => ({ planRoutine: () => ({ id: 'r', token: 't' }) }));
vi.mock('@/lib/specs/vision', async (original) => ({
  ...(await original<typeof import('@/lib/specs/vision')>()),
  loadVisionBodies: async () => ({}),
}));
vi.mock('@/lib/ideas/load', () => ({
  IDEA_COLUMNS: '*',
  ideaRowFrom: () => ({
    id: IDEA_ID,
    body: 'a search box',
    module: null,
    planItem: null,
    thread: [],
  }),
}));
vi.mock('@/lib/plan/runs', () => ({
  startRoutineRun: async ({ text }: { text: string }) => {
    state.fired.push(text);
    return state.routine;
  },
}));

const { submitIdea } = await import('@/app/dev/ideas/actions');

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  state.fired = [];
  state.routine = { ok: true, detail: 'started' };
});

describe('filing an idea from the header panel', () => {
  it('only saves on a plain Send', async () => {
    const result = await submitIdea({}, form({ body: 'a search box', module: '', code: 'right' }));

    expect(result.message).toBe('Idea saved.');
    expect(state.fired).toEqual([]);
  });

  it('saves and sends it to be shaped on Send and shape', async () => {
    const result = await submitIdea(
      {},
      form({ body: 'a search box', module: '', code: 'right', then: 'shape' }),
    );

    expect(result.error).toBeUndefined();
    expect(result.message).toMatch(/saved and sent/);
    expect(result.filed).toEqual({ table: 'ideas', id: IDEA_ID });
    expect(state.fired).toHaveLength(1);
    expect(state.fired[0]).toContain(`Shape idea ${IDEA_ID.slice(0, 8)}`);
  });

  it('says the idea was saved when the routine will not start', async () => {
    state.routine = { ok: false, error: 'No routine.' };

    const result = await submitIdea(
      {},
      form({ body: 'a search box', module: '', code: 'right', then: 'shape' }),
    );

    expect(result.error).toBe('Idea saved, but not sent: No routine.');
    expect(result.filed).toEqual({ table: 'ideas', id: IDEA_ID });
  });

  it('shapes nothing when the code is wrong', async () => {
    const result = await submitIdea(
      {},
      form({ body: 'a search box', module: '', code: 'wrong', then: 'shape' }),
    );

    expect(result.error).toBe('That code is not right.');
    expect(state.fired).toEqual([]);
  });
});
