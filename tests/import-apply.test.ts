/**
 * core.import_runs, core.import_keys and core.import_apply (plan #2432.2),
 * against the database.
 *
 * import_apply writes a batch of rows and their keys in one transaction, as
 * the caller: an insert makes the row with the id it is given and the run's
 * user, an update sets only the columns given, an update whose row has gone
 * writes no key, and a failed write leaves neither row nor key. A person sees
 * only their own runs and keys and cannot apply another account's run.
 */
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asUser, closeDb, createUser, truncateAll } from './helpers/db-core';

let userA = '';
let userB = '';
const ROW = '7a1c1f5e-0000-4000-8000-0000000000a1';
const ROW2 = '7a1c1f5e-0000-4000-8000-0000000000a2';

async function startRun(userId: string): Promise<string> {
  const [run] = await admin<{ id: string }[]>`
    insert into import_runs (user_id, source) values (${userId}, 'linkedin') returning id`;
  return run.id;
}

/** The writes as postgres.js takes a jsonb parameter. */
function asJson(writes: unknown): postgres.JSONValue {
  return writes as postgres.JSONValue;
}

function write(op: 'insert' | 'update', key: string, rowId: string, values: Record<string, unknown>) {
  return { op, kind: 'views', key, table: 'core.saved_views', row_id: rowId, values, hash: `h-${key}-${op}` };
}

beforeAll(async () => {
  await truncateAll();
  userA = await createUser('import-a@example.com');
  userB = await createUser('import-b@example.com');
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

describe('core.import_apply', () => {
  it('inserts rows with their ids and keys, as the person, under their own user id', async () => {
    const run = await startRun(userA);
    const writes = [
      write('insert', 'v1', ROW, { list: '/jobs', name: 'Imported', query: 'q=1' }),
      write('insert', 'v2', ROW2, { list: '/jobs', name: 'Second' }),
    ];
    const [{ import_apply: written }] = await asUser(userA, (tx) =>
      tx`select core.import_apply(${run}, ${tx.json(asJson(writes))}) as import_apply`,
    );
    expect(written).toBe(2);

    const rows = await admin`select id, user_id, name, query from saved_views order by name`;
    expect(rows).toEqual([
      { id: ROW, user_id: userA, name: 'Imported', query: 'q=1' },
      { id: ROW2, user_id: userA, name: 'Second', query: '' },
    ]);
    const keys = await admin`select kind, external_key, target_table, row_id, values_hash, run_id from import_keys order by external_key`;
    expect(keys[0]).toEqual({ kind: 'views', external_key: 'v1', target_table: 'core.saved_views', row_id: ROW, values_hash: 'h-v1-insert', run_id: run });
    expect(keys).toHaveLength(2);
  });

  it('updates only the columns given, moves the key to the new hash, and skips a row that has gone', async () => {
    const run = await startRun(userA);
    await admin`delete from saved_views where id = ${ROW2}`;
    const writes = [
      write('update', 'v1', ROW, { name: 'Renamed' }),
      write('update', 'v2', ROW2, { name: 'Gone' }),
    ];
    const [{ n }] = await asUser(userA, (tx) => tx`select core.import_apply(${run}, ${tx.json(asJson(writes))}) as n`);
    expect(n).toBe(1);
    const [row] = await admin`select name, query from saved_views where id = ${ROW}`;
    expect(row).toEqual({ name: 'Renamed', query: 'q=1' });
    const [key] = await admin`select values_hash, run_id from import_keys where external_key = 'v1'`;
    expect(key).toEqual({ values_hash: 'h-v1-update', run_id: run });
    const [gone] = await admin`select values_hash from import_keys where external_key = 'v2'`;
    expect(gone.values_hash).toBe('h-v2-insert');
  });

  it('writes neither rows nor keys when one write in the batch fails', async () => {
    const run = await startRun(userA);
    const writes = [
      write('insert', 'v3', '7a1c1f5e-0000-4000-8000-0000000000a3', { list: '/roles', name: 'Fine' }),
      write('insert', 'v4', '7a1c1f5e-0000-4000-8000-0000000000a4', { list: '/roles', name: 'fine' }),
    ];
    await expect(asUser(userA, (tx) => tx`select core.import_apply(${run}, ${tx.json(asJson(writes))})`)).rejects.toThrow();
    const rows = await admin`select id from saved_views where list = '/roles'`;
    expect(rows).toHaveLength(0);
    const keys = await admin`select id from import_keys where external_key in ('v3', 'v4')`;
    expect(keys).toHaveLength(0);
  });

  it('refuses another account\'s run, a finished run and an unknown table', async () => {
    const runA = await startRun(userA);
    const one = [write('insert', 'v5', '7a1c1f5e-0000-4000-8000-0000000000a5', { list: '/x', name: 'B' })];
    await expect(asUser(userB, (tx) => tx`select core.import_apply(${runA}, ${tx.json(asJson(one))})`)).rejects.toThrow(/not running|another account/);

    await admin`update import_runs set status = 'applied', finished_at = now() where id = ${runA}`;
    await expect(asUser(userA, (tx) => tx`select core.import_apply(${runA}, ${tx.json(asJson(one))})`)).rejects.toThrow(/not running/);

    const runB = await startRun(userA);
    const bad = [{ ...one[0], table: 'core.no_such_table' }];
    await expect(asUser(userA, (tx) => tx`select core.import_apply(${runB}, ${tx.json(asJson(bad))})`)).rejects.toThrow(/no table/);
  });

  it('shows a person only their own runs and keys', async () => {
    await startRun(userB);
    const runs = await asUser(userB, (tx) => tx`select user_id from import_runs`);
    expect(runs.every((r) => r.user_id === userB)).toBe(true);
    const keys = await asUser(userB, (tx) => tx`select id from import_keys`);
    expect(keys).toHaveLength(0);
    const theirs = await asUser(userA, (tx) => tx`select id from import_keys`);
    expect(theirs.length).toBeGreaterThan(0);
  });

  it('refuses a status it does not know and keeps one key per record', async () => {
    await expect(admin`insert into import_runs (user_id, source, status) values (${userA}, 'linkedin', 'done')`).rejects.toThrow();
    await expect(admin`
      insert into import_keys (user_id, source, kind, external_key, target_table, row_id, values_hash)
      values (${userA}, 'linkedin', 'views', 'v1', 'core.saved_views', ${ROW}, 'x')`).rejects.toThrow();
  });
});
