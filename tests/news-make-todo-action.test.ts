/**
 * Make a todo, the server action (plan #1369).
 *
 * What the action owns is the order of things: the story is saved first, the
 * todo is made from the saved row, and a story the newsletter no longer has
 * reaches neither. The writes themselves are lib/news/saved/stories.ts's and
 * lib/todo/links/story.ts's, tested beside them.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ME = '00000000-0000-4000-8000-000000000001';
const ISSUE = '11111111-1111-4111-8111-111111111111';
const SAVED = '22222222-2222-4222-8222-222222222222';

const ROW = {
  id: SAVED,
  issueId: ISSUE,
  headline: 'The quiet return of the tram',
  link: 'https://example.com/trams',
  senderName: 'Letters From Work',
};

const state = vi.hoisted(() => ({
  calls: [] as string[],
  inNewsletter: true,
  made: [] as unknown[],
  fail: false,
  revalidated: [] as string[],
}));

vi.mock('next/cache', () => ({
  revalidatePath: (path: string) => state.revalidated.push(path),
}));
vi.mock('next/navigation', () => ({ redirect: () => {} }));
vi.mock('@/lib/auth/server', () => ({
  requireUser: async () => ({ id: ME, email: 'me@example.com' }),
}));
vi.mock('@/lib/news/auth/server', () => ({ createNewsClient: async () => ({}) }));
vi.mock('@/lib/learn/auth/server', () => ({ createLearnClient: async () => ({}) }));
vi.mock('@/lib/todo/auth/server', () => ({ createTodoClient: async () => ({}) }));
vi.mock('@/lib/core/account/settings', () => ({
  loadAccountSettings: async () => ({ timezone: 'Europe/London' }),
}));
vi.mock('@/lib/news/saved/stories', () => ({
  saveStory: async () => (state.calls.push('saveStory'), state.inNewsletter),
  findSavedStory: async () => (state.calls.push('findSavedStory'), ROW),
  resaveStoryById: async (_client: unknown, id: string) => (
    state.calls.push('resaveStoryById'), id === SAVED ? ROW : null
  ),
  removeSavedStory: async () => {},
}));
vi.mock('@/lib/learn/tracks/news', () => ({ queueNewsStory: async () => ({}) }));
vi.mock('@/lib/todo/links/story', () => ({
  makeStoryTask: async (_client: unknown, userId: string, story: unknown, timezone: string) => {
    state.calls.push('makeStoryTask');
    if (state.fail) throw new Error('refused');
    state.made.push({ userId, story, timezone });
    return { taskId: 'task-1', created: state.made.length === 1 };
  },
}));

const { makeTodoFromStory } = await import('@/app/news/i/[id]/actions');

beforeEach(() => {
  state.calls = [];
  state.inNewsletter = true;
  state.made = [];
  state.fail = false;
  state.revalidated = [];
});

describe('makeTodoFromStory', () => {
  it('saves the story, then makes the todo from the saved row, and says which task', async () => {
    const result = await makeTodoFromStory({ issueId: ISSUE, headline: ROW.headline });

    expect(result).toEqual({ error: null, taskId: 'task-1' });
    expect(state.calls).toEqual(['saveStory', 'findSavedStory', 'makeStoryTask']);
    expect(state.made).toEqual([{ userId: ME, story: ROW, timezone: 'Europe/London' }]);
    expect(state.revalidated).toEqual(
      expect.arrayContaining([`/news/i/${ISSUE}`, '/news/saved', '/todo']),
    );
  });

  it('makes a todo from a row on the Saved tab by its id', async () => {
    const result = await makeTodoFromStory({ savedStoryId: SAVED });

    expect(result.error).toBeNull();
    expect(state.calls).toEqual(['resaveStoryById', 'makeStoryTask']);
  });

  it('makes nothing when the newsletter no longer has the story', async () => {
    state.inNewsletter = false;

    const result = await makeTodoFromStory({ issueId: ISSUE, headline: 'Gone' });

    expect(result.error).toMatch(/no longer in the newsletter/);
    expect(state.made).toEqual([]);
  });

  it('says so when Todo refuses it', async () => {
    state.fail = true;

    const result = await makeTodoFromStory({ savedStoryId: SAVED });

    expect(result.error).toMatch(/did not reach Todo/);
  });

  it('refuses a story it cannot name', async () => {
    expect((await makeTodoFromStory({ issueId: 'nope', headline: 'x' })).error).toBeTruthy();
    expect((await makeTodoFromStory({ savedStoryId: '33333333-3333-4333-8333-333333333333' })).error)
      .toBeTruthy();
    expect(state.made).toEqual([]);
  });
});
