/**
 * Promote and Demote (plan #2261.2): each changes the status and nothing
 * else, names the status it expects, and the other card actions accept a
 * planned post.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const USER_ID = 'owner-0000-0000-0000-000000000000';
const POST_ID = '11111111-1111-4111-8111-111111111111';

const state = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; op: string; args: unknown[] }>,
  error: null as { message: string } | null,
}));

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/lib/auth/server', () => ({
  createClient: async () => ({
    from(table: string) {
      const record = (op: string) => (...args: unknown[]) => {
        state.calls.push({ table, op, args });
        return builder;
      };
      const builder: Record<string, unknown> = {
        update: record('update'),
        eq: record('eq'),
        in: record('in'),
        then: (resolve: (value: unknown) => unknown) => resolve({ data: null, error: state.error }),
      };
      return builder;
    },
  }),
}));
vi.mock('@/lib/dev/owner', () => ({ requireOwner: async () => ({ id: USER_ID }) }));

const { promotePost, demotePost, dropPost } = await import('@/app/dev/posts/actions');

function form(id: string | null) {
  const f = new FormData();
  if (id) f.set('id', id);
  return f;
}

beforeEach(() => {
  state.calls = [];
  state.error = null;
});

describe('promotePost', () => {
  it('sets planned, only on a suggested post of the owner', async () => {
    expect(await promotePost({}, form(POST_ID))).toEqual({ message: 'Planned.' });
    expect(state.calls).toEqual([
      { table: 'social_posts', op: 'update', args: [{ status: 'planned' }] },
      { table: 'social_posts', op: 'eq', args: ['user_id', USER_ID] },
      { table: 'social_posts', op: 'eq', args: ['id', POST_ID] },
      { table: 'social_posts', op: 'eq', args: ['status', 'suggested'] },
    ]);
  });

  it('refuses a missing id without writing', async () => {
    expect(await promotePost({}, form(null))).toEqual({ error: 'Missing post.' });
    expect(state.calls).toEqual([]);
  });

  it('returns the database error', async () => {
    state.error = { message: 'boom' };
    expect(await promotePost({}, form(POST_ID))).toEqual({ error: 'boom' });
  });
});

describe('demotePost', () => {
  it('sets suggested, only on a planned post of the owner', async () => {
    expect(await demotePost({}, form(POST_ID))).toEqual({ message: 'Back with the suggestions.' });
    expect(state.calls).toEqual([
      { table: 'social_posts', op: 'update', args: [{ status: 'suggested' }] },
      { table: 'social_posts', op: 'eq', args: ['user_id', USER_ID] },
      { table: 'social_posts', op: 'eq', args: ['id', POST_ID] },
      { table: 'social_posts', op: 'eq', args: ['status', 'planned'] },
    ]);
  });

  it('refuses a missing id without writing', async () => {
    expect(await demotePost({}, form(null))).toEqual({ error: 'Missing post.' });
    expect(state.calls).toEqual([]);
  });
});

describe('the other card actions', () => {
  it('drop accepts a planned post as well as a suggested one', async () => {
    await dropPost({}, form(POST_ID));
    expect(state.calls).toContainEqual({ table: 'social_posts', op: 'in', args: ['status', ['suggested', 'planned']] });
  });
});
