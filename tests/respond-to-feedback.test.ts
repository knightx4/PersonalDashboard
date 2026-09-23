/**
 * Answering a blocked note leaves a turn from Dash under the answer.
 *
 * The answer goes back to the run that asked, not to the fast reply, so this
 * action used to write your comment and stop. The last turn in the thread was
 * yours, and a tagged one drew "Reading the row and replying…" for two hours
 * over a reply nothing was going to write. What is checked here is that the
 * thread always gets something back: your answer, then Dash saying where it
 * went.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const OWNER_ID = 'owner-0000-0000-0000-000000000000';
const NOTE_ID = '11111111-2222-4333-8444-555555555555';

const state = vi.hoisted(() => ({
  status: 'blocked',
  /** Every insert, with the table it went to. */
  inserts: [] as Array<{ table: string; row: Record<string, unknown> }>,
  updates: [] as Array<{ table: string; row: Record<string, unknown> }>,
}));

function fakeClient() {
  return {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      const self = () => builder;
      for (const key of ['select', 'eq']) builder[key] = self;
      builder.maybeSingle = async () => ({ data: { status: state.status }, error: null });
      builder.insert = async (row: Record<string, unknown>) => {
        state.inserts.push({ table, row });
        return { error: null };
      };
      builder.update = (row: Record<string, unknown>) => {
        state.updates.push({ table, row });
        return builder;
      };
      builder.then = (resolve: (value: unknown) => unknown) => resolve({ error: null });
      return builder;
    },
    rpc: async (name: string) =>
      name === 'app_owner'
        ? { data: { userId: OWNER_ID, email: 'owner@example.com' }, error: null }
        : { data: null, error: null },
  };
}

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/lib/auth/server', () => ({
  createClient: async () => fakeClient(),
  getUser: async () => ({ id: OWNER_ID, email: 'owner@example.com' }),
  requireUser: async () => ({ id: OWNER_ID, email: 'owner@example.com' }),
}));
vi.mock('@/lib/plan/runs', () => ({ startRoutineRun: async () => ({ ok: true }) }));
vi.mock('@/lib/feedback/routine', () => ({ notesRoutine: () => ({ id: 'r', token: 't' }) }));
vi.mock('@/lib/feedback/code', () => ({ codeMatches: () => true }));

const { respondToFeedback } = await import('@/app/dev/bugs/actions');

function answer(body: string) {
  const data = new FormData();
  data.set('id', NOTE_ID);
  data.set('body', body);
  return respondToFeedback({}, data);
}

beforeEach(() => {
  state.status = 'blocked';
  state.inserts = [];
  state.updates = [];
});

describe('answering a blocked note', () => {
  it('writes your answer, then a reply from Dash, and reopens the note', async () => {
    const result = await answer('@dash A');

    expect(result).toEqual({ message: 'Answered, and back in the queue.' });
    const comments = state.inserts.filter((i) => i.table === 'dev_comments');
    expect(comments.map((c) => c.row.author)).toEqual(['me', 'claude']);
    expect(comments[0].row.body).toBe('@dash A');
    expect(comments[1].row.feedback_item_id).toBe(NOTE_ID);
    expect(String(comments[1].row.body)).toMatch(/back in the queue/);
    expect(state.updates).toEqual([
      { table: 'feedback_items', row: { status: 'open', completed_at: null } },
    ]);
  });

  it('says nothing when the note was not waiting on an answer', async () => {
    state.status = 'open';
    const result = await answer('A');

    expect(result).toHaveProperty('error');
    expect(state.inserts).toEqual([]);
  });
});
