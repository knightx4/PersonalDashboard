/**
 * What a Dash run did, line by line (plan #1822), against the database.
 *
 * Done when the table holds lines for both plan runs and goal runs, only
 * their owner reads or writes them, a line cannot be hung on somebody else's
 * run, and both runs tables accept awaiting_input and stale.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asUser, closeDb, createUser, truncateAll } from './helpers/db-core';
import { RUN_ACTIVITY_KINDS, RUN_TABLES } from '@/lib/core/run-activities';

let userA = '';
let userB = '';
let planRun = '';
let goalRun = '';

beforeAll(async () => {
  await truncateAll();
  userA = await createUser('run-activities-a@example.com');
  userB = await createUser('run-activities-b@example.com');
  [{ id: planRun }] = await admin<{ id: string }[]>`
    insert into public.plan_runs (user_id, job, status)
    values (${userA}, 'queue', 'started') returning id`;
  [{ id: goalRun }] = await admin<{ id: string }[]>`
    insert into goals.runs (user_id, job, status)
    values (${userA}, 'daily', 'started') returning id`;
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

describe('a run line', () => {
  it('is written by the run\'s owner for a plan run and a goal run, and read only by them', async () => {
    await asUser(userA, (tx) => tx`
      insert into run_activities (user_id, run_table, run_id, kind, body)
      values (${userA}, 'plan_runs', ${planRun}, 'action', 'Claimed #1822'),
             (${userA}, 'goals.runs', ${goalRun}, 'thought', 'Reading the statements')`);
    await asUser(userA, (tx) => tx`
      insert into run_activities (user_id, run_table, run_id, kind, body, options)
      values (${userA}, 'plan_runs', ${planRun}, 'question', 'Which shape?', ${admin.json(['CSV', 'JSON'])})`);

    const mine = await asUser(userA, (tx) => tx<{ kind: string }[]>`
      select kind from run_activities where run_id = ${planRun} order by created_at`);
    expect(mine.map((r) => r.kind)).toEqual(['action', 'question']);
    const theirs = await asUser(userB, (tx) => tx`select id from run_activities`);
    expect(theirs).toHaveLength(0);
  });

  it('cannot be hung on somebody else\'s run, or a run in the wrong table', async () => {
    await expect(
      asUser(userB, (tx) => tx`
        insert into run_activities (user_id, run_table, run_id, kind, body)
        values (${userB}, 'plan_runs', ${planRun}, 'action', 'Not mine')`),
    ).rejects.toThrow();
    await expect(
      asUser(userA, (tx) => tx`
        insert into run_activities (user_id, run_table, run_id, kind, body)
        values (${userA}, 'goals.runs', ${planRun}, 'action', 'Wrong table')`),
    ).rejects.toThrow();
  });

  it('refuses an unknown kind, a blank body, and choices on anything but a question', async () => {
    await expect(admin`
      insert into run_activities (user_id, run_table, run_id, kind, body)
      values (${userA}, 'plan_runs', ${planRun}, 'note', 'Hello')`).rejects.toThrow();
    await expect(admin`
      insert into run_activities (user_id, run_table, run_id, kind, body)
      values (${userA}, 'plan_runs', ${planRun}, 'action', '  ')`).rejects.toThrow();
    await expect(admin`
      insert into run_activities (user_id, run_table, run_id, kind, body, options)
      values (${userA}, 'plan_runs', ${planRun}, 'action', 'Did it', ${admin.json(['A'])})`).rejects.toThrow();
  });

  it('allows exactly the kinds and run tables the code names', async () => {
    const [row] = await admin<{ kinds: string; tables: string }[]>`
      select
        (select pg_get_constraintdef(oid) from pg_constraint where conname = 'run_activities_kind_ck') as kinds,
        (select pg_get_constraintdef(oid) from pg_constraint where conname = 'run_activities_run_table_ck') as tables`;
    for (const kind of RUN_ACTIVITY_KINDS) expect(row.kinds).toContain(`'${kind}'`);
    for (const table of RUN_TABLES) expect(row.tables).toContain(`'${table}'`);
    expect(row.kinds.match(/'[a-z_]+'/g)).toHaveLength(RUN_ACTIVITY_KINDS.length);
  });
});

describe('the runs tables', () => {
  it('accept awaiting_input and stale', async () => {
    for (const status of ['awaiting_input', 'stale']) {
      await admin`update public.plan_runs set status = ${status} where id = ${planRun}`;
      await admin`update goals.runs set status = ${status} where id = ${goalRun}`;
    }
    const [plan] = await admin<{ status: string }[]>`select status from public.plan_runs where id = ${planRun}`;
    const [goal] = await admin<{ status: string }[]>`select status from goals.runs where id = ${goalRun}`;
    expect([plan.status, goal.status]).toEqual(['stale', 'stale']);
  });
});
