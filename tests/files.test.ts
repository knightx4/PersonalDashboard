/**
 * Files (supabase/migrations/0105) and the goals that link to them
 * (migrations-goals/0044), against the database.
 *
 * Done when a file keeps every version of its title and body, numbered by the
 * database, with nobody else able to write a version; when a goal or step can
 * link a file of the account's own and no other; and when another account
 * sees none of it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asUser, closeDb, createUser, truncateAll } from './helpers/db-core';

let userA = '';
let userB = '';
let goalA = '';
let goalB = '';

async function newFile(userId: string, title = 'Applications by role family'): Promise<string> {
  const [row] = await admin<{ id: string }[]>`
    insert into core.files (user_id, title, body, made_by, origin)
    values (${userId}, ${title}, '283 applications since March.', 'claude', ${`goals.items:${goalA}`})
    returning id`;
  return row.id;
}

beforeAll(async () => {
  await truncateAll();
  userA = await createUser('files-a@example.com');
  userB = await createUser('files-b@example.com');
  for (const [userId, set] of [
    [userA, (id: string) => (goalA = id)],
    [userB, (id: string) => (goalB = id)],
  ] as const) {
    const [area] = await admin<{ id: string }[]>`
      insert into goals.areas (user_id, name) values (${userId}, 'Career') returning id`;
    const [goal] = await admin<{ id: string }[]>`
      insert into goals.items (user_id, level, area_id, title)
      values (${userId}, 'goal', ${area.id}, 'Land a finance role') returning id`;
    set(goal.id);
  }
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

describe('a file', () => {
  it('keeps every version of its title and body, numbered by the database', async () => {
    const id = await newFile(userA);
    await admin`update core.files set body = 'Now split by role family.', change_note = 'Added the split' where id = ${id}`;
    // A summary is not a new version.
    await admin`update core.files set summary = 'FP&A converts best.' where id = ${id}`;
    await admin`update core.files set title = 'Role families' where id = ${id}`;

    const [file] = await admin<{ version: number; change_note: string | null }[]>`
      select version, change_note from core.files where id = ${id}`;
    expect(file).toEqual({ version: 3, change_note: null });

    const versions = await admin<{ version: number; title: string; change_note: string | null }[]>`
      select version, title, change_note from core.file_versions where file_id = ${id} order by version`;
    expect(versions).toEqual([
      { version: 1, title: 'Applications by role family', change_note: null },
      { version: 2, title: 'Applications by role family', change_note: 'Added the split' },
      { version: 3, title: 'Role families', change_note: null },
    ]);
  });

  it('lets the owner revise it, and keeps the version, but never write one directly', async () => {
    const id = await newFile(userA);
    await asUser(userA, (tx) => tx`update core.files set body = 'Revised.' where id = ${id}`);
    const [{ count }] = await admin<{ count: number }[]>`
      select count(*)::int as count from core.file_versions where file_id = ${id}`;
    expect(count).toBe(2);

    await expect(
      asUser(
        userA,
        (tx) => tx`
          insert into core.file_versions (file_id, user_id, version, title, body, made_by)
          values (${id}, ${userA}, 9, 'x', 'y', 'you')`,
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('is invisible to another account, versions and all', async () => {
    const id = await newFile(userA);
    const files = await asUser(userB, (tx) => tx`select id from core.files where id = ${id}`);
    const versions = await asUser(userB, (tx) => tx`select id from core.file_versions where file_id = ${id}`);
    expect(files).toHaveLength(0);
    expect(versions).toHaveLength(0);
  });
});

describe('linking a file from a goal', () => {
  it('links a file of the account’s own', async () => {
    const id = await newFile(userA);
    await asUser(
      userA,
      (tx) => tx`insert into goals.links (user_id, item_id, kind, target_id) values (${userA}, ${goalA}, 'file', ${id})`,
    );
    const links = await admin`select id from goals.links where item_id = ${goalA} and target_id = ${id}`;
    expect(links).toHaveLength(1);
  });

  it('refuses a file of another account, and an archived one', async () => {
    const theirs = await newFile(userB);
    await expect(
      admin`insert into goals.links (user_id, item_id, kind, target_id) values (${userA}, ${goalA}, 'file', ${theirs})`,
    ).rejects.toThrow(/no file/);

    const archived = await newFile(userA);
    await admin`update core.files set archived_at = now() where id = ${archived}`;
    await expect(
      admin`insert into goals.links (user_id, item_id, kind, target_id) values (${userA}, ${goalA}, 'file', ${archived})`,
    ).rejects.toThrow(/no file/);
    expect(goalB).not.toBe('');
  });
});

describe('Claude’s note on a goal', () => {
  it('is read by its owner only, and written by no signed-in session', async () => {
    await admin`insert into goals.briefs (user_id, item_id, body) values (${userA}, ${goalA}, 'Two steps closed this week.')`;
    await admin`insert into goals.briefs (user_id, body) values (${userA}, 'Across your goals: one question waits.')`;

    const own = await asUser(userA, (tx) => tx`select body from goals.briefs order by created_at`);
    expect(own).toHaveLength(2);
    const theirs = await asUser(userB, (tx) => tx`select body from goals.briefs`);
    expect(theirs).toHaveLength(0);

    await expect(
      asUser(userA, (tx) => tx`insert into goals.briefs (user_id, body) values (${userA}, 'Mine')`),
    ).rejects.toThrow(/permission denied/);
  });
});
