/**
 * The thumbs-down under a finished step's pictures (plan #1542): it reopens
 * the step with the person's words on its thread and a dated line on its
 * comment, and refuses a step that is still open or a screen the step never
 * passed.
 */
import { describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;

const OWNER = { id: 'owner-0000-0000-0000-000000000000', email: 'owner@example.com' };
const STEP = '11111111-2222-4333-8444-555555555555';

const state = vi.hoisted(() => ({
  step: null as Record<string, unknown> | null,
  passed: [] as Record<string, unknown>[],
  updates: [] as Record<string, unknown>[],
  turns: [] as Record<string, unknown>[],
}));

function fakeClient() {
  const builder = (table: string) => {
    const self: Record<string, unknown> = {
      select: () => self,
      update: (patch: Row) => {
        state.updates.push(patch);
        return self;
      },
      eq: () => self,
      in: () => self,
      limit: async () => ({ data: table === 'ui_checks' ? state.passed : [], error: null }),
      maybeSingle: async () => ({ data: state.step, error: null }),
      then: (resolve: (value: { data: null; error: null }) => unknown) =>
        resolve({ data: null, error: null }),
    };
    return self;
  };
  return {
    from: (table: string) => builder(table),
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
vi.mock('@/lib/thread/store', () => ({
  addThreadTurn: async (_db: unknown, turn: Row) => {
    state.turns.push(turn);
  },
}));

const { sendScreenBack } = await import('@/app/dev/plan/actions');

async function press(words: string, surface = 'dev-surfaces') {
  state.updates = [];
  state.turns = [];
  const form = new FormData();
  form.set('id', STEP);
  form.set('surface', surface);
  form.set('words', words);
  return sendScreenBack({}, form);
}

describe('sendScreenBack', () => {
  it('reopens a finished step with the words on its thread and comment', async () => {
    state.step = { number: 1541, status: 'done', comment: 'Done 2026-10-05: pictures.' };
    state.passed = [{ round: 2 }];
    const result = await press('The pictures crowd the row on a phone.');

    expect(result.error).toBeUndefined();
    expect(result.message).toContain('#1541 is open again');
    expect(state.turns).toEqual([
      expect.objectContaining({
        ref: `public.plan_items:${STEP}`,
        author: 'me',
        body: 'The pictures crowd the row on a phone.',
      }),
    ]);
    expect(state.updates).toHaveLength(1);
    const patch = state.updates[0];
    expect(patch.status).toBe('not_started');
    expect(patch.block_ask).toBeNull();
    expect(patch.block_kind).toBeNull();
    expect(patch.assignee).toBeNull();
    expect(patch.comment).toMatch(
      /^Done 2026-10-05: pictures\.\n\nSent back \d{4}-\d{2}-\d{2} from the dev-surfaces pictures: The pictures crowd the row on a phone\.$/,
    );
    // The trigger keeps the dates; the action never writes them.
    expect(patch).not.toHaveProperty('completed_at');
    expect(patch).not.toHaveProperty('started_at');
  });

  it('refuses a step that is not finished', async () => {
    state.step = { number: 1541, status: 'in_progress', comment: null };
    state.passed = [{ round: 2 }];
    const result = await press('Wrong.');
    expect(result.error).toBe('That step is already open.');
    expect(state.updates).toHaveLength(0);
    expect(state.turns).toHaveLength(0);
  });

  it('refuses a screen the step never passed', async () => {
    state.step = { number: 1541, status: 'done', comment: null };
    state.passed = [];
    const result = await press('Wrong.');
    expect(result.error).toBe('This step has no passed screen by that name.');
    expect(state.updates).toHaveLength(0);
  });

  it('asks for words before sending', async () => {
    state.step = { number: 1541, status: 'done', comment: null };
    const result = await press('   ');
    expect(result.error).toBe('Say what is wrong with the screen.');
    expect(state.updates).toHaveLength(0);
  });
});
