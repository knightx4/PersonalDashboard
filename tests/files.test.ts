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
  // The origin has to be a row of the file's own account (0156).
  const origin = `goals.items:${userId === userB ? goalB : goalA}`;
  const [row] = await admin<{ id: string }[]>`
    insert into core.files (user_id, title, body, made_by, origin)
    values (${userId}, ${title}, '283 applications since March.', 'claude', ${origin})
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

describe('being read (plan #1860)', () => {
  it('keeps its place in the list when read, and is unread again at a new version', async () => {
    const id = await newFile(userA);
    const [before] = await admin<{ updated_at: Date }[]>`select updated_at from core.files where id = ${id}`;

    await asUser(userA, (tx) => tx`update core.files set read_at = now() where id = ${id}`);
    const [read] = await admin<{ updated_at: Date; read_at: Date | null; version: number }[]>`
      select updated_at, read_at, version from core.files where id = ${id}`;
    expect(read.read_at).not.toBeNull();
    expect(read.updated_at).toEqual(before.updated_at);
    expect(read.version).toBe(1);

    await admin`update core.files set body = 'A second version.' where id = ${id}`;
    const [revised] = await admin<{ read_at: Date | null; version: number }[]>`
      select read_at, version from core.files where id = ${id}`;
    expect(revised).toEqual({ read_at: null, version: 2 });
  });
});

describe('filing what Dash writes for a step (plan #1860)', () => {
  let step = '';
  let subStep = '';

  beforeAll(async () => {
    const [row] = await admin<{ id: string }[]>`
      insert into goals.items (user_id, level, parent_id, kind, title)
      values (${userA}, 'step', ${goalA}, 'claude', 'List the firms hiring FP&A') returning id`;
    step = row.id;
    const [sub] = await admin<{ id: string }[]>`
      insert into goals.items (user_id, level, parent_id, kind, title)
      values (${userA}, 'step', ${step}, 'claude', 'Draft the note to Dana') returning id`;
    subStep = sub.id;
  });

  it('files it under the step and its goal, and makes a new version when the step is worked again', async () => {
    const [{ id: first }] = await admin<{ id: string }[]>`
      select goals.file_result(${step}, 'Firms hiring FP&A', 'Six firms are hiring.', '1. Acme', null) as id`;
    const links = await admin<{ item_id: string }[]>`
      select item_id from goals.links where kind = 'file' and target_id = ${first} order by item_id`;
    expect(links.map((l) => l.item_id).sort()).toEqual([goalA, step].sort());

    const [{ id: again }] = await admin<{ id: string }[]>`
      select goals.file_result(${step}, 'Firms hiring FP&A', 'Seven firms are hiring.', '1. Acme\n2. Brill', 'Added Brill.') as id`;
    expect(again).toBe(first);
    const [file] = await admin<{ version: number; change_note: string | null; origin: string }[]>`
      select version, change_note, origin from core.files where id = ${first}`;
    expect(file).toEqual({ version: 2, change_note: 'Added Brill.', origin: `goals.items:${step}` });
    const versions = await admin<{ body: string }[]>`
      select body from core.file_versions where file_id = ${first} order by version`;
    expect(versions.map((v) => v.body)).toEqual(['1. Acme', '1. Acme\n2. Brill']);
    const [{ count }] = await admin<{ count: number }[]>`
      select count(*)::int as count from goals.links where kind = 'file' and target_id = ${first}`;
    expect(count).toBe(2);
  });

  it('finds the goal however deep the step sits, and brings back an archived link', async () => {
    const [{ id }] = await admin<{ id: string }[]>`
      select goals.file_result(${subStep}, 'A note to Dana', null, 'Hi Dana,', null) as id`;
    await admin`update goals.links set archived_at = now() where target_id = ${id} and item_id = ${goalA}`;
    await admin`select goals.file_result(${subStep}, 'A note to Dana', null, 'Hi Dana, thanks.', null)`;
    const links = await admin<{ item_id: string; archived_at: Date | null }[]>`
      select item_id, archived_at from goals.links where kind = 'file' and target_id = ${id}`;
    expect(links.map((l) => l.item_id).sort()).toEqual([goalA, subStep].sort());
    expect(links.every((l) => l.archived_at === null)).toBe(true);
  });

  it('cannot be called from a signed-in session', async () => {
    await expect(
      asUser(userA, (tx) => tx`select goals.file_result(${step}, 'x', null, 'y', null)`),
    ).rejects.toThrow(/permission denied/);
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
