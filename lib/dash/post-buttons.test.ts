import { describe, expect, it, vi } from 'vitest';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { fakeSchemaDb, type FakeTables } from '../../tests/stubs/fake-schema-db';
import type { DashWriteContext } from './registry';

/**
 * rewrite_post writes the rows the Posts tab's edit writes (plan #2473.5).
 * The button's own server action runs on one copy of the person's rows, the
 * tool on another, from the same text, and the two copies are compared.
 */

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const ME = '00000000-0000-4000-8000-0000000000aa';
const state = vi.hoisted(() => ({ tables: {} as Record<string, Record<string, unknown>[]> }));

vi.mock('@/lib/auth/server', async (importOriginal) => {
  const { fakeSchemaDb: fake } = await import('../../tests/stubs/fake-schema-db');
  return {
    ...(await importOriginal<typeof import('@/lib/auth/server')>()),
    createClient: async () => fake(state.tables)('public'),
  };
});
vi.mock('@/lib/dev/owner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/dev/owner')>()),
  requireOwner: async () => ({ id: '00000000-0000-4000-8000-0000000000aa' }),
}));

const posts = await import('@/app/dev/posts/actions');
const { POST_WRITE_TOOLS } = await import('./post-writes');

const POST = '11111111-1111-4111-8111-111111111111';
const draft = {
  id: POST,
  user_id: ME,
  platform: 'x',
  angle: 'The plan page',
  status: 'suggested',
  draft: ['The plan page now shows every step.'],
  body: ['The plan page now shows every step.'],
  x_sending_at: null,
  x_thread_ids: [],
};

function ctx(tables: FakeTables): DashWriteContext {
  const db = fakeSchemaDb(tables);
  return {
    userId: ME,
    today: '2026-10-03',
    timezone: 'Europe/London',
    enabledModules: ['dev'],
    db: async (schema) => db(schema),
    searchSources: [],
    seen: () => true,
    goals: async () => db('goals') as unknown as GoalsSupabaseClient,
    createTask: async () => ({ id: null, error: 'unused' }),
  };
}

describe('rewrite_post writes what the Posts tab writes', () => {
  it('replaces the body and keeps the first draft, as the edit does', async () => {
    const seed = { 'public.social_posts': [draft] };
    const page = structuredClone(seed);
    const dash = structuredClone(seed);
    const text = ['The plan page shows every step now.', 'And what each one waits on.'];

    state.tables = page;
    const data = new FormData();
    data.set('id', POST);
    data.set('body', JSON.stringify(text));
    expect(await posts.editPostBody({}, data)).toEqual({ message: 'Saved.' });

    const result = await POST_WRITE_TOOLS.find((tool) => tool.name === 'rewrite_post')!.apply(ctx(dash), {
      post_ref: POST,
      posts: text,
    });
    expect(result.ok).toBe(true);
    expect(dash['public.social_posts']).toEqual(page['public.social_posts']);
    expect(dash['public.social_posts'][0].draft).toEqual(draft.draft);
  });

  it('refuses a draft that is no longer open, as the edit does', async () => {
    const tables = { 'public.social_posts': [{ ...draft, status: 'posted' }] };
    state.tables = structuredClone(tables);
    const data = new FormData();
    data.set('id', POST);
    data.set('body', JSON.stringify(['New text.']));
    expect(await posts.editPostBody({}, data)).toEqual({ error: 'This draft is no longer waiting to be posted.' });
    const result = await POST_WRITE_TOOLS.find((tool) => tool.name === 'rewrite_post')!.apply(ctx(tables), {
      post_ref: POST,
      posts: ['New text.'],
    });
    expect(result.ok).toBe(false);
  });
});
