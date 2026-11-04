/**
 * Threads with a Claude Code session and their messages (plan #2789.4),
 * against the database.
 *
 * Done when the owner can write and read a thread and its messages, another
 * account can neither read them nor write into them, and the shapes the
 * thread screen relies on are held by the table.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asUser, closeDb, createUser, truncateAll } from './helpers/db-core';

let owner = '';
let other = '';

beforeAll(async () => {
  await truncateAll();
  owner = await createUser('threads-owner@example.com');
  other = await createUser('threads-other@example.com');
  await admin`
    insert into public.dev_projects (id, user_id, label, owner, repo)
    values ('website', ${owner}, 'Website', 'someone', 'website')`;
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

async function ownerThread(title = 'Fix the footer'): Promise<string> {
  const [row] = await asUser(
    owner,
    (tx) => tx<{ id: string }[]>`
      insert into session_threads (user_id, title, project_id)
      values (${owner}, ${title}, 'website') returning id`,
  );
  return row.id;
}

describe('a session thread', () => {
  it('is written and read back by its owner, with its messages in order', async () => {
    const id = await ownerThread();
    const [thread] = await asUser(
      owner,
      (tx) => tx<{ state: string; session_id: string | null }[]>`
        select state, session_id from session_threads where id = ${id}`,
    );
    expect(thread).toEqual({ state: 'queued', session_id: null });

    await asUser(owner, async (tx) => {
      await tx`insert into session_messages (user_id, thread_id, author, body)
               values (${owner}, ${id}, 'person', 'The footer overlaps on phones')`;
      await tx`insert into session_messages (user_id, thread_id, author, kind, body, options)
               values (${owner}, ${id}, 'session', 'question', 'Stack the links or hide them?',
                       ${tx.json(['Stack them', 'Hide them'])})`;
    });
    const messages = await asUser(
      owner,
      (tx) => tx<{ author: string; kind: string }[]>`
        select author, kind from session_messages where thread_id = ${id} order by created_at`,
    );
    expect(messages).toEqual([
      { author: 'person', kind: 'text' },
      { author: 'session', kind: 'question' },
    ]);

    await asUser(owner, (tx) => tx`
      update session_messages set answer = 'Stack them', answered_at = now()
      where thread_id = ${id} and kind = 'question'`);
    await asUser(owner, (tx) => tx`
      update session_threads set state = 'working', session_id = 'session_abc' where id = ${id}`);
    const [after] = await admin<{ state: string }[]>`select state from session_threads where id = ${id}`;
    expect(after.state).toBe('working');
  });

  it('is invisible to another account, which cannot write into it', async () => {
    const id = await ownerThread('Only mine');
    await admin`insert into session_messages (user_id, thread_id, author, body)
                values (${owner}, ${id}, 'person', 'Private')`;

    expect(await asUser(other, (tx) => tx`select id from session_threads where id = ${id}`)).toHaveLength(0);
    expect(await asUser(other, (tx) => tx`select id from session_messages where thread_id = ${id}`)).toHaveLength(0);

    // Writing as the owner from another session is refused by the policy.
    await expect(
      asUser(other, (tx) => tx`insert into session_threads (user_id, title) values (${owner}, 'Not yours')`),
    ).rejects.toThrow();
    await expect(
      asUser(other, (tx) => tx`
        insert into session_messages (user_id, thread_id, author, body)
        values (${owner}, ${id}, 'person', 'Hello')`),
    ).rejects.toThrow();
    // Writing as themselves into the owner's thread is refused by the key.
    await expect(
      asUser(other, (tx) => tx`
        insert into session_messages (user_id, thread_id, author, body)
        values (${other}, ${id}, 'person', 'Hello')`),
    ).rejects.toThrow();
    // Nor can they change or remove what is there.
    const changed = await asUser(other, (tx) => tx`update session_threads set title = 'Taken' where id = ${id} returning id`);
    expect(changed).toHaveLength(0);
    const removed = await asUser(other, (tx) => tx`delete from session_messages where thread_id = ${id} returning id`);
    expect(removed).toHaveLength(0);
  });

  it('refuses a project of another account, an unknown state, or a message with nothing in it', async () => {
    await expect(
      admin`insert into session_threads (user_id, title, project_id) values (${other}, 'x', 'website')`,
    ).rejects.toThrow();
    await expect(
      admin`insert into session_threads (user_id, title, state) values (${owner}, 'x', 'paused')`,
    ).rejects.toThrow();
    const id = await ownerThread('Shapes');
    await expect(
      admin`insert into session_messages (user_id, thread_id, author, body) values (${owner}, ${id}, 'person', '  ')`,
    ).rejects.toThrow();
    await expect(
      admin`insert into session_messages (user_id, thread_id, author, kind, body)
            values (${owner}, ${id}, 'session', 'mockup', 'No link')`,
    ).rejects.toThrow();
    await expect(
      admin`insert into session_messages (user_id, thread_id, author, body, options)
            values (${owner}, ${id}, 'session', 'Not a question', ${admin.json(['A'])})`,
    ).rejects.toThrow();
    await expect(
      admin`insert into session_messages (user_id, thread_id, author, body, attachment_path)
            values (${owner}, ${id}, 'person', 'x', ${`${other}/file.png`})`,
    ).rejects.toThrow();
    const [file] = await admin<{ id: string }[]>`
      insert into session_messages (user_id, thread_id, author, attachment_path)
      values (${owner}, ${id}, 'person', ${`${owner}/a1-shot.png`}) returning id`;
    expect(file.id).toBeTruthy();
  });

  it('goes with the account', async () => {
    const id = await ownerThread('Goes');
    const temp = await createUser('threads-temp@example.com');
    const [t] = await admin<{ id: string }[]>`
      insert into session_threads (user_id, title) values (${temp}, 'Temp') returning id`;
    await admin`insert into session_messages (user_id, thread_id, author, body) values (${temp}, ${t.id}, 'person', 'x')`;
    await admin`delete from auth.users where id = ${temp}`;
    expect(await admin`select id from session_messages where user_id = ${temp}`).toHaveLength(0);
    expect(await admin`select id from session_threads where id = ${id}`).toHaveLength(1);
  });
});
