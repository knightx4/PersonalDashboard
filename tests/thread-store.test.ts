/**
 * The one thread store (plan #1470, migrations 0167 to 0169 and goals 0068),
 * against the database.
 *
 * Done when a turn written through core.add_thread_turn lands in the thread
 * under its row's ref and reads back through core.thread_turns, when another
 * account cannot write under that row, and when the tables threads used to
 * live in refuse new writes while a role's other notes still take them.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asUser, closeDb, createUser, truncateAll } from './helpers/db-core';

let me = '';
let them = '';
let idea = '';
let goal = '';
let role = '';
let company = '';
let file = '';

beforeAll(async () => {
  await truncateAll();
  me = await createUser('thread-store-a@example.com');
  them = await createUser('thread-store-b@example.com');

  [{ id: idea }] = await admin<{ id: string }[]>`
    insert into public.ideas (user_id, body) values (${me}, 'Group the ideas') returning id`;
  const [area] = await admin<{ id: string }[]>`
    insert into goals.areas (user_id, name) values (${me}, 'Career') returning id`;
  [{ id: goal }] = await admin<{ id: string }[]>`
    insert into goals.items (user_id, level, area_id, title)
    values (${me}, 'goal', ${area.id}, 'Land a finance role') returning id`;
  [{ id: company }] = await admin<{ id: string }[]>`
    insert into job_search.companies (user_id, slug, name) values (${me}, 'acme', 'Acme') returning id`;
  [{ id: role }] = await admin<{ id: string }[]>`
    insert into job_search.roles (user_id, company_id, title) values (${me}, ${company}, 'Analyst') returning id`;
  [{ id: file }] = await admin<{ id: string }[]>`
    insert into core.files (user_id, title, body, made_by, origin)
    values (${me}, 'Notes', 'Body', 'claude', ${`goals.items:${goal}`}) returning id`;
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

describe('core.acknowledge_thread_turn', () => {
  it('marks your own comment, keeps the first time, and reads back through the view', async () => {
    const ref = `public.ideas:${idea}`;
    const [{ id }] = await asUser(me, (tx) =>
      tx<{ id: string }[]>`select core.add_thread_turn(${me}, ${ref}, 'me', 'Done, thanks @dash') as id`,
    );
    const [first] = await asUser(me, (tx) =>
      tx<{ at: Date }[]>`select core.acknowledge_thread_turn(${me}, ${ref}, ${id}) as at`,
    );
    const [again] = await asUser(me, (tx) =>
      tx<{ at: Date }[]>`select core.acknowledge_thread_turn(${me}, ${ref}, ${id}) as at`,
    );
    expect(again.at).toEqual(first.at);
    const [row] = await asUser(me, (tx) =>
      tx<{ acknowledged_at: Date | null }[]>`select acknowledged_at from core.thread_turns where id = ${id}`,
    );
    expect(row.acknowledged_at).toEqual(first.at);
  });

  it('refuses Dash\'s own turn, another account\'s comment, and a comment under another row', async () => {
    const ref = `public.ideas:${idea}`;
    const [{ id: dashTurn }] = await asUser(me, (tx) =>
      tx<{ id: string }[]>`select core.add_thread_turn(${me}, ${ref}, 'claude', 'Noted.') as id`,
    );
    const [{ id: mine }] = await asUser(me, (tx) =>
      tx<{ id: string }[]>`select core.add_thread_turn(${me}, ${ref}, 'me', 'Another @dash') as id`,
    );
    await expect(
      asUser(me, (tx) => tx`select core.acknowledge_thread_turn(${me}, ${ref}, ${dashTurn})`),
    ).rejects.toThrow(/not a comment of yours/);
    await expect(
      asUser(them, (tx) => tx`select core.acknowledge_thread_turn(${them}, ${ref}, ${mine})`),
    ).rejects.toThrow(/not a comment of yours/);
    await expect(
      asUser(me, (tx) => tx`select core.acknowledge_thread_turn(${me}, ${`goals.items:${goal}`}, ${mine})`),
    ).rejects.toThrow(/not a comment of yours/);
  });
});

describe('core.add_thread_turn', () => {
  it('starts the thread under a row of yours and reads back in order, with its author', async () => {
    const ref = `public.ideas:${idea}`;
    await asUser(me, (tx) => tx`select core.add_thread_turn(${me}, ${ref}, 'me', 'Newest first?')`);
    await asUser(me, (tx) => tx`select core.add_thread_turn(${me}, ${ref}, 'claude', 'It is in plan #12.')`);

    const turns = await asUser(me, (tx) =>
      tx<{ author: string; body: string }[]>`
        select author, body from core.thread_turns where ref = ${ref} order by created_at`,
    );
    expect(turns).toEqual([
      { author: 'me', body: 'Newest first?' },
      { author: 'claude', body: 'It is in plan #12.' },
    ]);
    const [{ count }] = await admin<{ count: number }[]>`
      select count(*)::int as count from core.conversations where subject_kind = 'row' and subject_ref = ${ref}`;
    expect(count).toBe(1);
  });

  it('refuses a thread under another account\'s row, and an author it does not know', async () => {
    await expect(
      asUser(them, (tx) => tx`select core.add_thread_turn(${them}, ${`public.ideas:${idea}`}, 'me', 'Mine now')`),
    ).rejects.toThrow(/not a row of yours/);
    await expect(
      asUser(me, (tx) => tx`select core.add_thread_turn(${me}, ${`public.ideas:${idea}`}, 'maya', 'Hello')`),
    ).rejects.toThrow(/author must be me or claude/);
  });

  it('keeps the threads of one account out of another\'s reads', async () => {
    await asUser(me, (tx) => tx`select core.add_thread_turn(${me}, ${`goals.items:${goal}`}, 'me', 'Start with FP&A')`);
    const seen = await asUser(them, (tx) => tx`select id from core.thread_turns`);
    expect(seen).toEqual([]);
  });
});

describe('the tables threads used to live in', () => {
  it('refuse new comments and edits', async () => {
    await expect(
      admin`insert into public.dev_comments (user_id, idea_id, author, body) values (${me}, ${idea}, 'me', 'x')`,
    ).rejects.toThrow(/read-only/);
    await expect(
      admin`insert into goals.comments (user_id, item_id, author, body) values (${me}, ${goal}, 'me', 'x')`,
    ).rejects.toThrow(/read-only/);
    await expect(
      admin`insert into core.file_comments (user_id, file_id, author, body) values (${me}, ${file}, 'me', 'x')`,
    ).rejects.toThrow(/read-only/);
    await expect(
      admin`insert into job_search.notes (user_id, role_id, author, body) values (${me}, ${role}, 'me', 'x')`,
    ).rejects.toThrow(/read-only/);
  });

  it('still take a note on a company, which was never a thread', async () => {
    const [note] = await admin<{ id: string }[]>`
      insert into job_search.notes (user_id, company_id, body) values (${me}, ${company}, 'Met them at the fair') returning id`;
    expect(note.id).toBeTruthy();
  });
});
