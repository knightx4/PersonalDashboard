/**
 * core.record_dash_action, the one call a routine makes to record a change it
 * wrote through the connector (plan #1460), against the database.
 *
 * Done when the function records a row in one call. The row it writes has the
 * shape the app's recordDashAction writes, so undoDashAction and Home read it
 * the same way: done, with the subject ref, the op, the whole row after (and
 * before, for an update or a delete) and the summary. It refuses a row of
 * another account, a row that is not there, and the app's own roles.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asUser, closeDb, createUser, truncateAll } from './helpers/db-core';

let userA = '';
let userB = '';

type Recorded = {
  user_id: string;
  surface: string;
  kind: string;
  status: string;
  done_at: string | null;
  subject_ref: string;
  op: string;
  before_values: Record<string, unknown> | null;
  after_values: Record<string, unknown> | null;
  summary: string;
};

async function fileFor(userId: string, title = 'Notes on the visa form'): Promise<string> {
  const [row] = await admin<{ id: string }[]>`
    insert into core.files (user_id, title, body, made_by)
    values (${userId}, ${title}, 'What the form asks for.', 'claude')
    returning id`;
  return row.id;
}

async function recorded(id: string): Promise<Recorded> {
  const [row] = await admin<Recorded[]>`
    select user_id, surface, kind, status, done_at, subject_ref, op, before_values,
           after_values, summary
    from core.dash_actions where id = ${id}`;
  return row;
}

beforeAll(async () => {
  await truncateAll();
  userA = await createUser('record-a@example.com');
  userB = await createUser('record-b@example.com');
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

describe('core.record_dash_action', () => {
  it('records an insert in one call, reading the row after itself', async () => {
    const file = await fileFor(userA);
    const [{ id }] = await admin<{ id: string }[]>`
      select core.record_dash_action(${userA}, ${`core.files:${file}`}, 'insert',
        'write_file', 'Dash wrote up   the visa form.') as id`;
    const row = await recorded(id);
    expect(row).toMatchObject({
      user_id: userA,
      surface: 'routine',
      kind: 'write_file',
      status: 'done',
      subject_ref: `core.files:${file}`,
      op: 'insert',
      before_values: null,
      summary: 'Dash wrote up the visa form.',
    });
    expect(row.done_at).not.toBeNull();
    expect(row.after_values).toMatchObject({ id: file, user_id: userA, title: 'Notes on the visa form' });
  });

  it('records an update with the row dash_before kept, all in one transaction', async () => {
    const file = await fileFor(userA, 'Old title');
    const ref = `core.files:${file}`;
    const id = await admin.begin(async (tx) => {
      await tx`select core.dash_before(${ref})`;
      await tx`update core.files set title = 'New title' where id = ${file}`;
      const [r] = await tx<{ id: string }[]>`
        select core.record_dash_action(${userA}, ${ref}, 'update', 'retitle_file',
          'Dash renamed the file.') as id`;
      return r.id;
    });
    const row = await recorded(id);
    expect(row.before_values).toMatchObject({ id: file, title: 'Old title' });
    expect(row.after_values).toMatchObject({ id: file, title: 'New title' });
  });

  it('records a delete with the row passed in, and no row after', async () => {
    const file = await fileFor(userA, 'Gone soon');
    const ref = `core.files:${file}`;
    const [{ before }] = await admin<{ before: Record<string, unknown> }[]>`
      select core.dash_subject_row(${ref}) as before`;
    await admin`delete from core.files where id = ${file}`;
    const [{ id }] = await admin<{ id: string }[]>`
      select core.record_dash_action(${userA}, ${ref}, 'delete', 'remove_file',
        'Dash took the spare copy away.', ${admin.json(before as never)}) as id`;
    const row = await recorded(id);
    expect(row.after_values).toBeNull();
    expect(row.before_values).toMatchObject({ id: file, title: 'Gone soon' });
  });

  it('keeps an update with no before row, which then cannot be undone', async () => {
    const file = await fileFor(userA);
    const [{ id }] = await admin<{ id: string }[]>`
      select core.record_dash_action(${userA}, ${`core.files:${file}`}, 'update',
        'touch_file', 'Dash touched the file.') as id`;
    expect((await recorded(id)).before_values).toBeNull();
  });

  it('cuts a long summary at 300 characters', async () => {
    const file = await fileFor(userA);
    const [{ id }] = await admin<{ id: string }[]>`
      select core.record_dash_action(${userA}, ${`core.files:${file}`}, 'insert',
        'write_file', ${'word '.repeat(100)}) as id`;
    const summary = (await recorded(id)).summary;
    expect(summary.length).toBeLessThanOrEqual(300);
    expect(summary.endsWith('…')).toBe(true);
  });

  it("refuses another account's row, a row that is not there and a ref outside the app", async () => {
    const file = await fileFor(userB);
    await expect(
      admin`select core.record_dash_action(${userA}, ${`core.files:${file}`}, 'insert', 'write_file', 'Dash wrote it.')`,
    ).rejects.toThrow(/another account/);
    await expect(
      admin`select core.record_dash_action(${userA}, 'core.files:6f1c1f5e-0000-4000-8000-00000000dead', 'insert', 'write_file', 'Dash wrote it.')`,
    ).rejects.toThrow(/is not there/);
    await expect(
      admin`select core.record_dash_action(${userA}, 'auth.users:6f1c1f5e-0000-4000-8000-00000000dead', 'insert', 'write_file', 'Dash wrote it.')`,
    ).rejects.toThrow(/does not record changes/);
    await expect(
      admin`select core.record_dash_action(${userA}, ${`core.files:${file}`}, 'insert', 'write_file', 'Dash wrote it.', null, 'ask')`,
    ).rejects.toThrow(/routine or scheduled/);
  });

  it('is not open to the person signed in to the app', async () => {
    const file = await fileFor(userA);
    await expect(
      asUser(userA, (tx) => tx`select core.record_dash_action(${userA}, ${`core.files:${file}`}, 'insert', 'write_file', 'Dash wrote it.')`),
    ).rejects.toThrow(/permission denied/);
  });
});
