import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSchemaDb, type FakeTables } from '../../tests/stubs/fake-schema-db';
import type { SchemaClient } from '@/lib/ask/db';

/**
 * Each News tool writes the rows its button writes (plan #2473.5). The
 * button's own server action runs on one copy of the person's rows, the tool
 * on another, from the same input, and the two copies are compared. The
 * session and the clients the pages make are stubbed to the same in-memory
 * database.
 */

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

const ME = '00000000-0000-4000-8000-0000000000aa';

const state = vi.hoisted(() => ({ tables: {} as Record<string, Record<string, unknown>[]> }));

/** The fake clients, with news.unsave_story as the database has it: the row goes unless something points at it. */
function clients(tables: FakeTables) {
  const db = fakeSchemaDb(tables);
  return (schema: string): SchemaClient => {
    const client = db(schema);
    if (schema !== 'news') return client;
    return Object.assign(client, {
      rpc: (name: string, args: { story_id: string }) => {
        if (name !== 'unsave_story') return Promise.resolve({ data: null, error: { message: `no function ${name}` } });
        const rows = (tables['news.saved_stories'] ??= []);
        const row = rows.find((r) => r.id === args.story_id);
        if (row) rows.splice(rows.indexOf(row), 1);
        return Promise.resolve({ data: row?.issue_id ?? null, error: null });
      },
    });
  };
}

vi.mock('@/lib/auth/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/server')>()),
  requireUser: async () => ({ id: '00000000-0000-4000-8000-0000000000aa' }),
}));
vi.mock('@/lib/core/account/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/core/account/settings')>()),
  loadAccountSettings: async () => ({ timezone: 'Europe/London', enabledModules: ['news', 'todo'] }),
}));
vi.mock('@/lib/news/auth/server', () => ({ createNewsClient: async () => clients(state.tables)('news') }));
vi.mock('@/lib/todo/auth/server', () => ({ createTodoClient: async () => clients(state.tables)('todo') }));
vi.mock('@/lib/core/auth/server', () => ({ createCoreClient: async () => clients(state.tables)('core') }));

const issuePage = await import('@/app/news/i/[id]/actions');
const savedPage = await import('@/app/news/saved/actions');
const home = await import('@/app/home/actions');
const { NEWS_WRITES, runNewsWrite } = await import('./news-writes');

const ISSUE = '11111111-1111-4111-8111-111111111111';
const STORY = '22222222-2222-4222-8222-222222222222';
const WATCH = '33333333-3333-4333-8333-333333333333';

const issue = { id: ISSUE, user_id: ME, subject: 'The Weekly', read_at: '2026-10-02T08:00:00Z' };
const story = {
  id: STORY,
  user_id: ME,
  issue_id: ISSUE,
  headline: 'Rates hold steady',
  link: 'https://example.com/rates',
  sender_name: 'The Weekly',
  saved_at: '2026-10-02T09:00:00Z',
  unsaved_at: null,
};
const watch = { id: WATCH, user_id: ME, title: 'Kettle under 40', status: 'running' };

function twins(seed: FakeTables): [FakeTables, FakeTables] {
  return [structuredClone(seed), structuredClone(seed)];
}

async function press<T>(tables: FakeTables, act: () => Promise<T>): Promise<T> {
  state.tables = tables;
  return act();
}

/** The rows as the database holds them, less what each insert makes up for itself. */
function rows(tables: FakeTables, key: string): Record<string, unknown>[] {
  return (tables[key] ?? []).map((row) => {
    const rest = { ...row };
    delete rest.id;
    delete rest.created_at;
    delete rest.task_id;
    return rest;
  });
}

async function tool(name: string, tables: FakeTables, input: Record<string, unknown>) {
  const db = clients(tables);
  const write = NEWS_WRITES.find((entry) => entry.name === name)!;
  const made = await runNewsWrite(write, { userId: ME, news: db('news'), learn: db('learn'), todo: db('todo'), core: db('core') }, input);
  if ('ok' in made) throw new Error(made.error);
  return made;
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-03T09:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the News tools write what their buttons write', () => {
  it('mark_issue_unread puts the newsletter back as Mark unread does', async () => {
    const [page, dash] = twins({ 'news.issues': [issue] });
    await press(page, () => issuePage.markIssueUnread(form({ issueId: ISSUE })));
    const made = await tool('mark_issue_unread', dash, { issue_ref: ISSUE });
    expect(rows(dash, 'news.issues')).toEqual(rows(page, 'news.issues'));
    expect(rows(dash, 'news.issues')[0].read_at).toBeNull();
    expect(made.before?.read_at).toBe(issue.read_at);
  });

  it('save_story with saved false takes the story off as Remove on Saved does', async () => {
    const [page, dash] = twins({ 'news.issues': [issue], 'news.saved_stories': [story] });
    expect(await press(page, () => savedPage.removeSaved(STORY))).toEqual({ error: null });
    const made = await tool('save_story', dash, { saved: false, saved_story_ref: STORY });
    expect(rows(dash, 'news.saved_stories')).toEqual(rows(page, 'news.saved_stories'));
    expect(rows(dash, 'news.saved_stories')).toEqual([]);
    expect(made.op).toBe('delete');
  });

  it('make_todo_from_story makes the todo and its link as Make a todo does', async () => {
    const seed = { 'news.issues': [issue], 'news.saved_stories': [story], 'todo.tasks': [], 'todo.task_links': [] };
    const [page, dash] = twins(seed);
    const pressed = await press(page, () => issuePage.makeTodoFromStory({ savedStoryId: STORY }));
    expect(pressed.error).toBeNull();
    const made = await tool('make_todo_from_story', dash, { saved_story_ref: STORY });
    for (const key of ['todo.tasks', 'todo.task_links', 'news.saved_stories']) {
      expect(rows(dash, key), key).toEqual(rows(page, key));
    }
    expect(rows(dash, 'todo.tasks')).toHaveLength(1);
    expect(made.after?.title).toBe('Rates hold steady');
  });

  it('stop_watch stops the watch as Stop on Home does', async () => {
    const [page, dash] = twins({ 'core.watches': [watch] });
    expect(await press(page, () => home.stopWatch(form({ id: WATCH })))).toEqual({ ok: true });
    const made = await tool('stop_watch', dash, { watch_ref: WATCH });
    expect(rows(dash, 'core.watches')).toEqual(rows(page, 'core.watches'));
    expect(made.after?.status).toBe('stopped');
  });

  it('refuses a watch that is not running, as the button does', async () => {
    const tables = { 'core.watches': [{ ...watch, status: 'stopped' }] };
    const write = NEWS_WRITES.find((entry) => entry.name === 'stop_watch')!;
    const db = clients(tables);
    expect(await runNewsWrite(write, { userId: ME, news: db('news'), learn: db('learn'), todo: db('todo'), core: db('core') }, { watch_ref: WATCH })).toEqual({
      ok: false,
      error: 'That watch is not running any more.',
    });
  });
});
