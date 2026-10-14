import { describe, expect, it } from 'vitest';
import { NEWS_CHANGE_KINDS } from '@/lib/ask/news-changes';
import { fakeSchemaDb, type FakeTables } from '../../tests/stubs/fake-schema-db';
import { NEWS_WRITES, runNewsWrite, switchedOff, type NewsWriteEnv } from './news-writes';

/**
 * The News writes an agent makes (plan #1894.9.4): each names one row, scoped
 * to the person by its own filter (the connector runs them with no row level
 * security), and reports the values its Undo needs.
 */

const ME = '00000000-0000-4000-8000-0000000000aa';
const ISSUE = '11111111-1111-4111-8111-111111111111';
const STORY = '22222222-2222-4222-8222-222222222222';
const WATCH = '33333333-3333-4333-8333-333333333333';

/** unsave_story as the database has it: delete the row unless something points at it. */
function env(tables: FakeTables, pointedAt = false): NewsWriteEnv {
  const db = fakeSchemaDb(tables);
  const news = db('news');
  const rows = (tables['news.saved_stories'] ??= []);
  Object.assign(news, {
    rpc: (name: string, args: { story_id: string }) => {
      if (name !== 'unsave_story') return Promise.resolve({ data: null, error: { message: `no function ${name}` } });
      const row = rows.find((r) => r.id === args.story_id);
      if (row && pointedAt) row.unsaved_at = '2026-10-14T00:00:00Z';
      else if (row) rows.splice(rows.indexOf(row), 1);
      return Promise.resolve({ data: row?.issue_id ?? null, error: null });
    },
  });
  return { userId: ME, news, learn: db('learn'), todo: db('todo'), core: db('core') };
}

const write = (name: string) => NEWS_WRITES.find((entry) => entry.name === name)!;

async function made(name: string, tables: FakeTables, input: Record<string, unknown>, pointedAt = false) {
  const result = await runNewsWrite(write(name), env(tables, pointedAt), input);
  if ('ok' in result) throw new Error(result.error);
  return result;
}

const issue = (fields: Record<string, unknown> = {}) => ({
  id: ISSUE,
  user_id: ME,
  subject: 'The Morning Brief',
  read_at: '2026-10-13T08:00:00Z',
  ...fields,
});

const saved = (fields: Record<string, unknown> = {}) => ({
  id: STORY,
  user_id: ME,
  issue_id: ISSUE,
  headline: 'Rates hold steady',
  unsaved_at: null,
  ...fields,
});

describe('the News writes', () => {
  it('are the kinds Ask keeps them under, in order', () => {
    expect(NEWS_WRITES.map((entry) => entry.name)).toEqual([...NEWS_CHANGE_KINDS]);
  });

  it('puts a newsletter back in the unread list, keeping the row as it was', async () => {
    const tables = { 'news.issues': [issue()] };
    const change = await made('mark_issue_unread', tables, { issue_ref: ISSUE });
    expect(change.op).toBe('update');
    expect(change.subjectRef).toBe(`news.issues:${ISSUE}`);
    expect(change.before).toMatchObject({ read_at: '2026-10-13T08:00:00Z' });
    expect(change.after).toMatchObject({ read_at: null });
    expect(change.summary).toBe('Dash marked the newsletter "The Morning Brief" unread.');
    expect(await runNewsWrite(write('mark_issue_unread'), env(tables), { issue_ref: ISSUE })).toEqual({
      ok: false,
      error: 'That newsletter is unread already.',
    });
  });

  it("refuses a newsletter that is not the person's", async () => {
    const tables = { 'news.issues': [issue({ user_id: 'someone else' })] };
    const refused = { ok: false, error: 'There is no newsletter issue of theirs with that ref. Look it up first.' };
    expect(await runNewsWrite(write('mark_issue_unread'), env(tables), { issue_ref: ISSUE })).toEqual(refused);
    expect(
      await runNewsWrite(write('send_story_to_learn'), env(tables), { issue_ref: ISSUE, headline: 'Rates hold steady' }),
    ).toEqual(refused);
  });

  it('takes a story off Saved as a delete, or as an update when something points at it', async () => {
    const gone = await made('save_story', { 'news.saved_stories': [saved()] }, { saved: false, saved_story_ref: STORY });
    expect(gone.op).toBe('delete');
    expect(gone.after).toBeNull();
    expect(gone.before).toMatchObject({ headline: 'Rates hold steady' });
    expect(gone.summary).toBe('Dash took the story "Rates hold steady" off Saved.');

    const kept = await made('save_story', { 'news.saved_stories': [saved()] }, { saved: false, saved_story_ref: STORY }, true);
    expect(kept.op).toBe('update');
    expect(kept.after).toMatchObject({ unsaved_at: '2026-10-14T00:00:00Z' });

    const notSaved = { 'news.saved_stories': [saved({ unsaved_at: '2026-10-01T00:00:00Z' })] };
    expect(await runNewsWrite(write('save_story'), env(notSaved), { saved: false, saved_story_ref: STORY })).toEqual({
      ok: false,
      error: 'That story is not saved.',
    });
  });

  it('asks for saved, and for a story to name', async () => {
    const tables: FakeTables = {};
    expect(await runNewsWrite(write('save_story'), env(tables), { saved_story_ref: STORY })).toMatchObject({ ok: false });
    expect(await runNewsWrite(write('make_todo_from_story'), env(tables), {})).toEqual({
      ok: false,
      error: 'Name the story: issue_ref and headline, or saved_story_ref for one already on Saved.',
    });
  });

  it('stops a running watch, and refuses one that has stopped', async () => {
    const tables = { 'core.watches': [{ id: WATCH, user_id: ME, title: 'Lego Titanic', status: 'running' }] };
    const change = await made('stop_watch', tables, { watch_ref: WATCH });
    expect(change.before).toMatchObject({ status: 'running' });
    expect(change.after).toMatchObject({ status: 'stopped' });
    expect(change.summary).toBe('Dash stopped the price watch "Lego Titanic".');
    expect(await runNewsWrite(write('stop_watch'), env(tables), { watch_ref: WATCH })).toEqual({
      ok: false,
      error: 'That watch is not running any more.',
    });
  });

  it('names the first workspace a change needs that is switched off', () => {
    expect(switchedOff(write('send_story_to_learn'), ['news', 'todo'])).toBe('learn');
    expect(switchedOff(write('stop_watch'), [])).toBeNull();
  });
});
