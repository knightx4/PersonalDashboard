/**
 * A session's report of what it is doing (plan #2800.1), against the database.
 *
 * Done when a report writes the session's row for its step as the account it
 * names, a second report rewrites that row, a run or project of another
 * account is refused, and the person reads only their own rows.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asUser, closeDb, createUser, truncateAll } from './helpers/db-core';
import { PROGRESS_STATES } from '@/lib/plan/session-progress';

let userA = '';
let userB = '';
let stepA = '';
let runA = '';
let runB = '';

type Row = { id: string; state: string; action: string; needs: string | null; plan_item_id: string | null; plan_run_id: string | null };

function report(user: string, args: { state: string; action: string; needs?: string | null; run?: string | null; project?: string | null; session?: string }) {
  return admin<Row[]>`
    select id, state, action, needs, plan_item_id, plan_run_id
    from core.report_session_progress(
      ${user}::uuid, ${args.session ?? 'cse_test'}, ${args.state}, ${args.action}, ${args.needs ?? null},
      ${args.run ?? null}::uuid, null::uuid, null::uuid, ${args.project ?? null})`;
}

beforeAll(async () => {
  await truncateAll();
  userA = await createUser('session-progress-a@example.com');
  userB = await createUser('session-progress-b@example.com');
  [{ id: stepA }] = await admin<{ id: string }[]>`
    insert into plan_items (user_id, title) values (${userA}, 'A step') returning id`;
  [{ id: runA }] = await admin<{ id: string }[]>`
    insert into public.plan_runs (user_id, plan_item_id, job, status)
    values (${userA}, ${stepA}, 'step', 'started') returning id`;
  [{ id: runB }] = await admin<{ id: string }[]>`
    insert into public.plan_runs (user_id, job, status) values (${userB}, 'queue', 'started') returning id`;
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

describe('core.report_session_progress', () => {
  it('writes the row for the run\'s step, then rewrites it on the next report', async () => {
    const [first] = await report(userA, { state: 'working', action: 'Claimed the step', run: runA });
    expect(first).toMatchObject({ state: 'working', plan_item_id: stepA, plan_run_id: runA, needs: null });

    const [second] = await report(userA, { state: 'waiting', action: 'Asked which shape', needs: 'CSV or JSON?', run: runA });
    expect(second.id).toBe(first.id);
    expect(second).toMatchObject({ state: 'waiting', needs: 'CSV or JSON?' });

    // Done clears what it needed.
    const [third] = await report(userA, { state: 'done', action: 'Committed it', needs: 'stale' });
    expect(third.needs).toBeNull();
    const rows = await admin`select id from core.session_progress where user_id = ${userA}`;
    // The third report named no run, so it is the session's row with no step.
    expect(rows).toHaveLength(2);
  });

  it('refuses another account\'s run, a project that is not theirs, a wait with no need and a blank action', async () => {
    await expect(report(userA, { state: 'working', action: 'x', run: runB })).rejects.toThrow(/no plan run/);
    await expect(report(userA, { state: 'working', action: 'x', project: 'music-pipeline' })).rejects.toThrow(/no project/);
    await expect(report(userA, { state: 'waiting', action: 'x' })).rejects.toThrow(/what it needs/);
    await expect(report(userA, { state: 'working', action: '  ' })).rejects.toThrow(/one line/);
    await expect(report(userA, { state: 'thinking', action: 'x' })).rejects.toThrow();
  });

  it('is read by its owner only, and written by nobody but the service role', async () => {
    await report(userB, { state: 'working', action: 'Theirs', run: runB, session: 'cse_other' });
    const mine = await asUser(userA, (tx) => tx<{ action: string }[]>`select action from core.session_progress`);
    expect(mine.map((row) => row.action)).not.toContain('Theirs');
    expect(mine.length).toBeGreaterThan(0);
    await expect(
      asUser(userA, (tx) => tx`
        select core.report_session_progress(${userA}::uuid, 'cse_x', 'working', 'Mine')`),
    ).rejects.toThrow();
    await expect(
      asUser(userA, (tx) => tx`
        insert into core.session_progress (user_id, session_id, state, action)
        values (${userA}, 'cse_y', 'working', 'Direct')`),
    ).rejects.toThrow();
  });

  it('announces a wait once: a repeat report keeps notified_at, a new wait or a new question clears it (plan #2800.4)', async () => {
    const session = 'cse_notify';
    const stamp = async () =>
      (await admin<{ notified_at: Date | null }[]>`
        select notified_at from core.session_progress where user_id = ${userA} and session_id = ${session}`)[0].notified_at;

    await report(userA, { session, state: 'waiting', action: 'Asked', needs: 'CSV or JSON?' });
    expect(await stamp()).toBeNull();
    await admin`update core.session_progress set notified_at = now() where user_id = ${userA} and session_id = ${session}`;

    await report(userA, { session, state: 'waiting', action: 'Still waiting', needs: 'CSV or JSON?' });
    expect(await stamp()).not.toBeNull();

    await report(userA, { session, state: 'waiting', action: 'Asked again', needs: 'Which delimiter?' });
    expect(await stamp()).toBeNull();

    await admin`update core.session_progress set notified_at = now() where user_id = ${userA} and session_id = ${session}`;
    await report(userA, { session, state: 'working', action: 'Carrying on' });
    await report(userA, { session, state: 'waiting', action: 'Asked', needs: 'Which delimiter?' });
    expect(await stamp()).toBeNull();
  });

  it('allows exactly the states the code names', async () => {
    const [row] = await admin<{ def: string }[]>`
      select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'session_progress_state_ck'`;
    for (const state of PROGRESS_STATES) expect(row.def).toContain(`'${state}'`);
    expect(row.def.match(/'[a-z]+'::text/g)).toHaveLength(PROGRESS_STATES.length);
  });
});
