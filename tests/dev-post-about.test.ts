/**
 * Post about this (plan #1420): the changelog line's button starts the posts
 * run focused on that one step, and refuses a step a post may not come from.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const USER_ID = 'owner-0000-0000-0000-000000000000';
const STEP_ID = '11111111-2222-4333-8444-555555555555';

type Step = {
  id: string;
  number: number;
  module: string | null;
  kind: string;
  status: string;
  title: string;
  detail: string | null;
  comment: string | null;
};

const state = vi.hoisted(() => ({
  step: null as unknown,
  waiting: [] as Array<{ id: string }>,
  started: [] as unknown[],
}));

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/lib/auth/server', () => ({
  createClient: async () => ({
    from(table: string) {
      const builder: Record<string, unknown> = {};
      for (const key of ['select', 'eq', 'contains', 'limit']) builder[key] = () => builder;
      builder.maybeSingle = async () => ({ data: state.step, error: null });
      builder.then = (resolve: (value: unknown) => unknown) =>
        resolve({ data: table === 'social_posts' ? state.waiting : null, error: null });
      return builder;
    },
  }),
}));
vi.mock('@/lib/dev/owner', () => ({ requireOwner: async () => ({ id: USER_ID }) }));
vi.mock('@/lib/dev/posts-run', () => ({
  startPostsRun: async (input: unknown) => {
    state.started.push(input);
    return { ok: true, message: 'Sent.' };
  },
}));

const { suggestPostAbout } = await import('@/app/dev/posts/actions');

function press(number: string) {
  const form = new FormData();
  form.set('number', number);
  return suggestPostAbout({}, form);
}

function step(over: Partial<Step> = {}): Step {
  return {
    id: STEP_ID,
    number: 1419,
    module: 'dev',
    kind: 'build',
    status: 'done',
    title: 'Add the Posts tab to Dev',
    detail: 'A tab that lists the drafts.',
    comment: null,
    ...over,
  };
}

beforeEach(() => {
  state.step = step();
  state.waiting = [];
  state.started = [];
});

describe('suggestPostAbout', () => {
  it('starts the posts run focused on that one step', async () => {
    expect(await press('1419')).toEqual({ message: 'Sent.' });
    expect(state.started).toEqual([
      expect.objectContaining({ userId: USER_ID, focus: { number: 1419 } }),
    ]);
  });

  it('accepts a step of the app as a whole', async () => {
    state.step = step({ module: null });
    expect(await press('1419')).toEqual({ message: 'Sent.' });
  });

  it('refuses a step in another workspace', async () => {
    state.step = step({ module: 'vault' });
    expect(await press('1419')).toEqual({ error: expect.any(String) });
    expect(state.started).toEqual([]);
  });

  it('refuses a step whose text names another workspace', async () => {
    state.step = step({ detail: 'Pulls in the recruiter emails.' });
    expect(await press('1419')).toEqual({ error: expect.any(String) });
    expect(state.started).toEqual([]);
  });

  it('refuses a step that has not shipped', async () => {
    state.step = step({ status: 'in_progress' });
    expect(await press('1419')).toEqual({ error: expect.any(String) });
    expect(state.started).toEqual([]);
  });

  it('refuses when a draft about the step is already waiting', async () => {
    state.waiting = [{ id: 'a-draft' }];
    expect(await press('1419')).toEqual({
      error: 'A draft about this step is already on the Posts tab.',
    });
    expect(state.started).toEqual([]);
  });

  it('refuses a missing number', async () => {
    expect(await press('')).toEqual({ error: 'Missing step.' });
    expect(state.started).toEqual([]);
  });
});
