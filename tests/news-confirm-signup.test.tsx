/**
 * Confirm on a signup email (plan #1724): the two states the button has as a
 * server render draws them, and the action that records the press.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const ME = '00000000-0000-4000-8000-000000000001';
const ISSUE = '11111111-1111-4111-8111-111111111111';

const state = vi.hoisted(() => ({
  marked: [] as unknown[][],
  fail: false,
  revalidated: [] as string[],
}));

vi.mock('next/cache', () => ({ revalidatePath: (p: string) => state.revalidated.push(p) }));
vi.mock('next/navigation', () => ({ redirect: () => {} }));
vi.mock('@/lib/auth/server', () => ({ requireUser: async () => ({ id: ME }) }));
vi.mock('@/lib/news/auth/server', () => ({ createNewsClient: async () => ({}) }));
vi.mock('@/lib/learn/auth/server', () => ({ createLearnClient: async () => ({}) }));
vi.mock('@/lib/todo/auth/server', () => ({ createTodoClient: async () => ({}) }));
vi.mock('@/lib/core/account/settings', () => ({ loadAccountSettings: async () => ({}) }));
vi.mock('@/lib/news/saved/stories', () => ({}));
vi.mock('@/lib/learn/tracks/news', () => ({}));
vi.mock('@/lib/todo/links/story', () => ({}));
vi.mock('@/lib/news/issues/read', () => ({
  markUnread: async () => {},
  markConfirmed: async (...args: unknown[]) => {
    if (state.fail) throw new Error('db down');
    state.marked.push(args.slice(1));
    return true;
  },
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => () => {} }));

const { ConfirmSignup } = await import('@/components/news/confirm-signup');
const { confirmIssue } = await import('@/app/news/i/[id]/actions');

const LINK = 'https://example.com/confirm?token=abc';

describe('ConfirmSignup', () => {
  it('shows Confirm as a new-tab link to the stored address while unconfirmed', () => {
    const html = renderToStaticMarkup(
      <ConfirmSignup issueId={ISSUE} url={LINK} confirmedLabel={null} />,
    );
    expect(html).toContain('Confirm');
    expect(html).toContain(`href="${LINK}"`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain('Confirmed');
  });

  it('shows when it was confirmed, and no link, once confirmed', () => {
    const html = renderToStaticMarkup(
      <ConfirmSignup issueId={ISSUE} url={LINK} confirmedLabel="Sat 10 Oct, 9:41 AM" />,
    );
    expect(html).toContain('Confirmed Sat 10 Oct, 9:41 AM');
    expect(html).not.toContain('href=');
  });
});

describe('confirmIssue', () => {
  beforeEach(() => {
    state.marked = [];
    state.fail = false;
    state.revalidated = [];
  });

  it('marks the issue for the signed-in account and refreshes the pages', async () => {
    expect(await confirmIssue(ISSUE)).toEqual({ error: null });
    expect(state.marked).toEqual([[ME, ISSUE]]);
    expect(state.revalidated).toEqual([`/news/i/${ISSUE}`, '/news/all']);
  });

  it('refuses an id that is not a uuid without touching the table', async () => {
    expect((await confirmIssue('nope')).error).toBeTruthy();
    expect(state.marked).toEqual([]);
  });

  it('returns an error when the write fails', async () => {
    state.fail = true;
    expect((await confirmIssue(ISSUE)).error).toBeTruthy();
    expect(state.revalidated).toEqual([]);
  });
});
