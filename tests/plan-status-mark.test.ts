/**
 * What a status press on the plan row does to the Mine mark.
 *
 * #719 settled the two halves. Blocking a step you marked as yours leaves the
 * mark on it, so the step is still yours when the block lifts; putting one
 * back to Not started takes the mark off, which is what hands it back to the
 * overnight runner. The third is #715's and was already there: pressing In
 * progress marks a step nobody has marked.
 *
 * The patch `setPlanItemStatus` sends is the whole of the claim, so that is
 * what this reads. A status the press leaves the mark alone for sends no
 * `assignee` at all, which is the difference that matters: writing the mark
 * back would be the same value for you and a row rewritten for anyone reading
 * the column's history.
 *
 * tests/plan-view.test.tsx stubs this action rather than running it, so this
 * is the only cover over either write.
 */
import { describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;

const OWNER = { id: 'owner-0000-0000-0000-000000000000', email: 'owner@example.com' };
const STEP = '11111111-2222-4333-8444-555555555555';

const state = vi.hoisted(() => ({
  /** The row `setPlanItemStatus` reads back, when it reads one at all. */
  current: null as Row | null,
  /** Every patch it sent to plan_items. */
  updates: [] as Row[],
}));

/**
 * Enough of the query builder for one read and one update. The filters are
 * ignored: the action puts the id and the user in them, and the owner check
 * above it is what this file is not testing.
 */
function fakeClient() {
  const builder = () => {
    const self: Record<string, unknown> = {
      select: () => self,
      update: (patch: Row) => {
        state.updates.push(patch);
        return self;
      },
      eq: () => self,
      maybeSingle: async () => ({ data: state.current, error: null }),
      then: (resolve: (value: { data: null; error: null }) => unknown) =>
        resolve({ data: null, error: null }),
    };
    return self;
  };

  return {
    from: () => builder(),
    rpc: async (name: string) =>
      name === 'app_owner'
        ? { data: { userId: OWNER.id, email: OWNER.email }, error: null }
        : { data: null, error: null },
  };
}

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

vi.mock('@/lib/auth/server', () => ({
  createClient: async () => fakeClient(),
  getUser: async () => OWNER,
  requireUser: async () => OWNER,
}));

const { setPlanItemStatus } = await import('@/app/dev/plan/actions');

/** Press one status on a step whose row reads `current`. */
async function press(status: string, current: Row | null = null) {
  state.current = current;
  state.updates = [];

  const form = new FormData();
  form.set('id', STEP);
  form.set('status', status);

  const result = await setPlanItemStatus({}, form);
  return { result, patch: state.updates.at(-1) ?? {} };
}

describe('blocking a step', () => {
  it('leaves the Mine mark where it is', async () => {
    const { patch } = await press('blocked', { number: 12, assignee: 'me' });

    expect(patch.status).toBe('blocked');
    expect(patch).not.toHaveProperty('assignee');
  });

  it('no longer says the step was taken back off Dash', async () => {
    const { result } = await press('blocked', { number: 12, assignee: 'me' });

    expect(result).toEqual({ message: 'Updated.' });
  });
});

describe('putting a step back to Not started', () => {
  it('clears a mark you set by hand', async () => {
    const { patch } = await press('not_started', { number: 12, assignee: 'me' });

    expect(patch.status).toBe('not_started');
    expect(patch.assignee).toBeNull();
  });

  /**
   * The press writes the mark itself, so the row it clears is as often one
   * nobody chose to mark. It clears that one without reading the row, which is
   * why the unmarked case is worth its own line.
   */
  it('clears the mark the In progress press wrote', async () => {
    const marked = await press('in_progress', { number: 12, assignee: null });
    expect(marked.patch.assignee).toBe('me');

    const { patch } = await press('not_started');
    expect(patch.assignee).toBeNull();
  });
});

describe('pressing In progress', () => {
  it('marks a step nobody has marked', async () => {
    const { patch } = await press('in_progress', { number: 12, assignee: null });

    expect(patch.status).toBe('in_progress');
    expect(patch.assignee).toBe('me');
  });

  it('leaves a step that already carries a mark alone', async () => {
    const { patch } = await press('in_progress', { number: 12, assignee: 'me' });

    expect(patch).not.toHaveProperty('assignee');
  });
});
