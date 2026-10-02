/**
 * The four-week hold on the Shape button (plan #1484).
 *
 * Before 30 October 2026 an idea a session filed is refused with the reason
 * and no routine is fired; one the person filed is sent as before.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const IDEA_ID = '11111111-2222-4333-8444-555555555555';

const state = vi.hoisted(() => ({
  fired: [] as string[],
  source: 'me' as string,
}));

function fakeClient() {
  const builder: Record<string, unknown> = {};
  for (const key of ['select', 'eq']) builder[key] = () => builder;
  builder.maybeSingle = async () => ({ data: { id: IDEA_ID }, error: null });
  return { from: () => builder };
}

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/lib/auth/server', () => ({ createClient: async () => fakeClient() }));
vi.mock('@/lib/dev/owner', () => ({ requireOwner: async () => ({ id: 'owner' }) }));
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
    source: state.source,
    thread: [],
  }),
}));
vi.mock('@/lib/plan/runs', () => ({
  startRoutineRun: async ({ text }: { text: string }) => {
    state.fired.push(text);
    return { ok: true, detail: 'started' };
  },
}));

const { shapeIdea } = await import('@/app/dev/ideas/actions');

function form(): FormData {
  const data = new FormData();
  data.set('id', IDEA_ID);
  return data;
}

beforeEach(() => {
  state.fired = [];
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-15T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('shaping during the hold', () => {
  it('refuses an idea a session filed, saying why', async () => {
    state.source = 'claude';
    const result = await shapeIdea({}, form());

    expect(result.error).toMatch(/filed by a session/);
    expect(result.error).toMatch(/30 October 2026/);
    expect(state.fired).toEqual([]);
  });

  it('shapes an idea the person filed', async () => {
    state.source = 'me';
    const result = await shapeIdea({}, form());

    expect(result.error).toBeUndefined();
    expect(state.fired).toHaveLength(1);
  });

  it('shapes a session idea once the hold has ended', async () => {
    state.source = 'claude';
    vi.setSystemTime(new Date('2026-10-30T09:00:00Z'));
    const result = await shapeIdea({}, form());

    expect(result.error).toBeUndefined();
    expect(state.fired).toHaveLength(1);
  });
});
