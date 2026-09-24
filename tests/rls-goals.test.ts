/**
 * The goals schema: isolation, and the history every change writes.
 *
 * The spec asks that nothing happen to a goal without a record of it, and
 * that the record be written by the database so a write cannot forget it
 * (docs/GOALS-SPEC.md, "History"). So the triggers are what is tested here:
 * inserting, editing and archiving a row each leave a history row with the
 * old and new values and who made the change, and nobody can edit that record
 * afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asUser, closeDb, createUser, truncateAll } from './helpers/db-goals';

type HistoryRow = {
  table_name: string;
  action: string;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  actor: string;
  capture_id: string | null;
};

let userA = '';
let userB = '';
let areaA = '';
let goalA = '';

async function historyOf(rowId: string): Promise<HistoryRow[]> {
  return admin<HistoryRow[]>`
    select table_name, action, old_values, new_values, actor, capture_id
    from history where row_id = ${rowId} order by id`;
}

beforeAll(async () => {
  await truncateAll();
  userA = await createUser('goals-a@example.com');
  userB = await createUser('goals-b@example.com');

  const [area] = await admin<{ id: string }[]>`
    insert into areas (user_id, name) values (${userA}, 'Money') returning id`;
  areaA = area.id;
  const [goal] = await admin<{ id: string }[]>`
    insert into items (user_id, level, area_id, title)
    values (${userA}, 'goal', ${areaA}, 'Pay off the debts') returning id`;
  goalA = goal.id;
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

describe('goals history', () => {
  it('records an insert with the whole new row and who made it', async () => {
    const id = await asUser(userA, async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        insert into items (user_id, level, parent_id, kind, title)
        values (${userA}, 'step', ${goalA}, 'mine', 'List every balance') returning id`;
      return row.id;
    });

    const rows = await historyOf(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ table_name: 'items', action: 'insert', actor: 'me' });
    expect(rows[0].old_values).toBeNull();
    expect(rows[0].new_values).toMatchObject({ title: 'List every balance', kind: 'mine' });
  });

  it('records an edit as the columns that changed, old and new', async () => {
    const [step] = await admin<{ id: string }[]>`
      insert into items (user_id, level, parent_id, kind, title)
      values (${userA}, 'step', ${goalA}, 'mine', 'Call the card company') returning id`;

    await asUser(userA, (tx) => tx`
      update items set title = 'Call both card companies', status = 'done' where id = ${step.id}`);

    const rows = await historyOf(step.id);
    expect(rows.map((r) => r.action)).toEqual(['insert', 'update']);
    const edit = rows[1];
    expect(edit.actor).toBe('me');
    expect(edit.old_values).toMatchObject({ title: 'Call the card company', status: 'open' });
    expect(edit.new_values).toMatchObject({ title: 'Call both card companies', status: 'done' });
    // closed_at moved with the status, and updated_at is left out as noise.
    expect(edit.old_values).toHaveProperty('closed_at', null);
    expect(edit.new_values?.closed_at).not.toBeNull();
    expect(edit.new_values).not.toHaveProperty('updated_at');
    expect(Object.keys(edit.new_values ?? {}).sort()).toEqual(['closed_at', 'status', 'title']);
  });

  it('records archiving as its own action, and the row stays', async () => {
    const [area] = await admin<{ id: string }[]>`
      insert into areas (user_id, name) values (${userA}, 'Health') returning id`;

    await asUser(userA, (tx) => tx`update areas set archived_at = now() where id = ${area.id}`);
    await asUser(userA, (tx) => tx`update areas set archived_at = null where id = ${area.id}`);

    const rows = await historyOf(area.id);
    expect(rows.map((r) => r.action)).toEqual(['insert', 'archive', 'unarchive']);
    expect(rows[1].old_values).toEqual({ archived_at: null });
    expect(rows[1].new_values?.archived_at).not.toBeNull();

    const [still] = await admin<{ count: number }[]>`
      select count(*)::int from areas where id = ${area.id}`;
    expect(still.count).toBe(1);
  });

  it('writes nothing for an update that changed nothing', async () => {
    await asUser(userA, (tx) => tx`update areas set name = name where id = ${areaA}`);
    const rows = await historyOf(areaA);
    expect(rows.map((r) => r.action)).toEqual(['insert']);
  });

  it('records every table in the schema, not only the tree', async () => {
    const [reading] = await asUser(userA, (tx) => tx<{ id: string }[]>`
      insert into readings (user_id, item_id, value) values (${userA}, ${goalA}, 18250.40)
      returning id`);
    const rows = await historyOf(reading.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ table_name: 'readings', action: 'insert' });
  });

  it('names Claude for a write with no session, and capture when the request says so', async () => {
    // No session behind it: a routine working through SQL.
    const [fromClaude] = await admin<{ id: string }[]>`
      insert into items (user_id, level, parent_id, kind, title)
      values (${userA}, 'step', ${goalA}, 'claude', 'Draft the payoff order') returning id`;
    expect((await historyOf(fromClaude.id))[0].actor).toBe('claude');

    const [capture] = await admin<{ id: string }[]>`
      insert into captures (user_id, body) values (${userA}, 'paid 400 off the visa')
      returning id`;

    const id = await asUser(userA, async (tx) => {
      await tx.unsafe(`set local goals.actor = 'capture'`);
      await tx.unsafe(`set local goals.capture_id = '${capture.id}'`);
      const [row] = await tx<{ id: string }[]>`
        insert into items (user_id, level, parent_id, kind, title)
        values (${userA}, 'step', ${goalA}, 'mine', 'Pay the visa') returning id`;
      return row.id;
    });
    expect((await historyOf(id))[0]).toMatchObject({ actor: 'capture', capture_id: capture.id });
  });

  it('records a hard delete with the row as it was', async () => {
    const [step] = await admin<{ id: string }[]>`
      insert into items (user_id, level, parent_id, kind, title)
      values (${userA}, 'step', ${goalA}, 'mine', 'Made by mistake') returning id`;
    await asUser(userA, (tx) => tx`delete from items where id = ${step.id}`);

    const rows = await historyOf(step.id);
    expect(rows.map((r) => r.action)).toEqual(['insert', 'delete']);
    expect(rows[1].old_values).toMatchObject({ title: 'Made by mistake' });
  });

  it('cannot be edited or deleted, by the owner or anyone', async () => {
    await expect(
      asUser(userA, (tx) => tx`update history set actor = 'claude' where row_id = ${goalA}`),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(userA, (tx) => tx`delete from history where row_id = ${goalA}`),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(userA, (tx) => tx`
        insert into history (user_id, table_name, row_id, action, new_values, actor)
        values (${userA}, 'items', ${goalA}, 'insert', '{}'::jsonb, 'me')`),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('goals isolation', () => {
  it('shows a user only their own goals and history', async () => {
    const theirs = await asUser(userB, (tx) => tx<{ id: string }[]>`select id from items`);
    expect(theirs).toEqual([]);
    const theirHistory = await asUser(userB, (tx) => tx<{ id: string }[]>`select id from history`);
    expect(theirHistory).toEqual([]);

    const mine = await asUser(userA, (tx) => tx<{ id: string }[]>`
      select id from history where row_id = ${goalA}`);
    expect(mine).toHaveLength(1);
  });

  it('refuses a goal hung off another account\'s area', async () => {
    // RLS alone would allow this: foreign keys are checked bypassing it. The
    // composite key carrying user_id is what refuses it.
    const [areaB] = await admin<{ id: string }[]>`
      insert into areas (user_id, name) values (${userB}, 'The city') returning id`;
    await expect(
      asUser(userA, (tx) => tx`
        insert into items (user_id, level, area_id, title)
        values (${userA}, 'goal', ${areaB.id}, 'Borrowed area')`),
    ).rejects.toThrow(/items_area_fk/);
  });

  it('refuses a row written on somebody else', async () => {
    await expect(
      asUser(userB, (tx) => tx`insert into areas (user_id, name) values (${userA}, 'Theirs')`),
    ).rejects.toThrow(/row-level security/);
  });
});

describe('goals shape', () => {
  it('holds a goal under an area and a step under a goal, never the other way', async () => {
    await expect(
      admin`insert into items (user_id, level, parent_id, kind, title)
            values (${userA}, 'goal', ${goalA}, 'mine', 'Goal with a parent')`,
    ).rejects.toThrow(/items_shape_ck/);
    await expect(
      admin`insert into items (user_id, level, area_id, title)
            values (${userA}, 'step', ${areaA}, 'Step with no kind')`,
    ).rejects.toThrow(/items_shape_ck/);
  });

  it('requires a rhythm to say how often', async () => {
    await expect(
      admin`insert into items (user_id, level, parent_id, kind, title)
            values (${userA}, 'step', ${goalA}, 'rhythm', 'One city event')`,
    ).rejects.toThrow(/items_rhythm_ck/);
    const [row] = await admin<{ id: string }[]>`
      insert into items (user_id, level, parent_id, kind, title, rhythm_count, rhythm_period)
      values (${userA}, 'step', ${goalA}, 'rhythm', 'One city event', 1, 'week') returning id`;
    expect(row.id).toBeTruthy();
  });
});

describe('goals and the account', () => {
  it('goes with the account when it is deleted', async () => {
    const leaving = await createUser('goals-leaving@example.com');
    const [area] = await admin<{ id: string }[]>`
      insert into areas (user_id, name) values (${leaving}, 'Career') returning id`;
    const [goal] = await admin<{ id: string }[]>`
      insert into items (user_id, level, area_id, title)
      values (${leaving}, 'goal', ${area.id}, 'Get a job') returning id`;
    await admin`
      insert into items (user_id, level, parent_id, kind, title)
      values (${leaving}, 'step', ${goal.id}, 'mine', 'Apply to three roles')`;

    await admin`delete from auth.users where id = ${leaving}`;

    const [left] = await admin<{ items: number; history: number }[]>`
      select (select count(*)::int from items where user_id = ${leaving}) as items,
             (select count(*)::int from history where user_id = ${leaving}) as history`;
    expect(left).toEqual({ items: 0, history: 0 });
  });
});

describe('RLS coverage', () => {
  it('has row level security enabled on every table in the schema', async () => {
    const rows = await admin<{ tablename: string }[]>`
      select c.relname as tablename
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'goals' and c.relkind = 'r' and not c.relrowsecurity
      order by 1`;
    expect(rows.map((r) => r.tablename)).toEqual([]);
  });

  it('records history on every table but history itself', async () => {
    const tables = await admin<{ tablename: string }[]>`
      select c.relname as tablename
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'goals' and c.relkind = 'r' and c.relname <> 'history'
      order by 1`;
    const recorded = await admin<{ tablename: string }[]>`
      select distinct c.relname as tablename
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_proc p on p.oid = t.tgfoid
      where n.nspname = 'goals' and p.proname = 'record_history' and not t.tgisinternal
      order by 1`;
    expect(recorded.map((r) => r.tablename)).toEqual(tables.map((r) => r.tablename));
    expect(tables.map((r) => r.tablename)).toEqual([
      'areas',
      'captures',
      'items',
      'periods',
      'readings',
      'runs',
      'suggestions',
    ]);
  });

  it('reaches nothing in the schema as an anonymous visitor', async () => {
    const rows = await admin<{ grantee: string }[]>`
      select distinct grantee from information_schema.role_table_grants
      where table_schema = 'goals' and grantee = 'anon'`;
    expect(rows.map((r) => r.grantee)).toEqual([]);
  });
});
