/**
 * Send to Learn, the server action (plan #1368).
 *
 * What the action owns is the order of things: the story is saved first, the
 * reading is handed the saved row, and a story the newsletter no longer has
 * reaches neither. The writes themselves are lib/news/saved/stories.ts's and
 * lib/learn/tracks/news.ts's, tested beside them.
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
  queued: [] as unknown[],
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
vi.mock('@/lib/news/saved/stories', () => ({
  saveStory: async () => (state.calls.push('saveStory'), state.inNewsletter),
  findSavedStory: async () => (state.calls.push('findSavedStory'), ROW),
  resaveStoryById: async (_client: unknown, id: string) => (
    state.calls.push('resaveStoryById'), id === SAVED ? ROW : null
  ),
  removeSavedStory: async () => {},
}));
vi.mock('@/lib/learn/tracks/news', () => ({
  queueNewsStory: async (_client: unknown, userId: string, story: unknown) => {
    state.calls.push('queueNewsStory');
    state.queued.push({ userId, story });
    return { trackId: 'track-1', readingId: 'reading-1', created: state.queued.length === 1 };
  },
}));

const { sendStoryToLearn } = await import('@/app/news/i/[id]/actions');

beforeEach(() => {
  state.calls = [];
  state.inNewsletter = true;
  state.queued = [];
  state.revalidated = [];
});

describe('sendStoryToLearn', () => {
  it('saves the story, then queues the saved row, and says where it went', async () => {
    const result = await sendStoryToLearn({ issueId: ISSUE, headline: ROW.headline });

    expect(result).toEqual({ error: null, readingId: 'reading-1', trackId: 'track-1' });
    expect(state.calls).toEqual(['saveStory', 'findSavedStory', 'queueNewsStory']);
    expect(state.queued).toEqual([{ userId: ME, story: ROW }]);
    expect(state.revalidated).toEqual(
      expect.arrayContaining([`/news/i/${ISSUE}`, '/news/saved', '/learn']),
    );
  });

  it('sends a row from the Saved tab by its id', async () => {
    const result = await sendStoryToLearn({ savedStoryId: SAVED });

    expect(result.error).toBeNull();
    expect(state.calls).toEqual(['resaveStoryById', 'queueNewsStory']);
  });

  it('queues nothing when the newsletter no longer has the story', async () => {
    state.inNewsletter = false;

    const result = await sendStoryToLearn({ issueId: ISSUE, headline: 'Gone' });

    expect(result.error).toMatch(/no longer in the newsletter/);
    expect(state.queued).toEqual([]);
  });

  it('refuses a story it cannot name', async () => {
    expect((await sendStoryToLearn({ issueId: 'nope', headline: 'x' })).error).toBeTruthy();
    expect((await sendStoryToLearn({ savedStoryId: '33333333-3333-4333-8333-333333333333' })).error)
      .toBeTruthy();
    expect(state.queued).toEqual([]);
  });
});
