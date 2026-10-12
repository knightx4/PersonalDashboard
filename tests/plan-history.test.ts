/**
 * The plan's history (plan #1829): a change to a step from the page and one
 * from a script each leave a row with the actor, the old and new status and
 * the time. The trigger writes it, so a write cannot forget to.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asUser, closeDb, createUser, truncateAll } from './helpers/db';

type HistoryRow = {
  action: string;
  actor: string;
  old_status: string | null;
  new_status: string | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  item_number: number | null;
  created_at: Date;
};

let owner = '';
let other = '';

async function historyOf(id: string): Promise<HistoryRow[]> {
  return admin<HistoryRow[]>`
    select action, actor, old_status, new_status, old_values, new_values, item_number, created_at
    from plan_history where item_id = ${id} order by id`;
}

beforeAll(async () => {
  await truncateAll();
  owner = await createUser('plan-history-a@example.com');
  other = await createUser('plan-history-b@example.com');
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

describe('plan history', () => {
  it('records a status change from the page as the person, and from a script as Dash', async () => {
    const [step] = await admin<{ id: string; number: number }[]>`
      insert into plan_items (user_id, title) values (${owner}, 'A step') returning id, number`;

    await asUser(owner, async (tx) => {
      await tx`update plan_items set status = 'in_progress' where id = ${step.id}`;
    });
    await admin`update plan_items set status = 'done' where id = ${step.id}`;

    const rows = await historyOf(step.id);
    expect(rows.map((r) => r.action)).toEqual(['insert', 'update', 'update']);
    expect(rows[1]).toMatchObject({
      actor: 'me',
      old_status: 'not_started',
      new_status: 'in_progress',
      item_number: step.number,
    });
    expect(rows[1].old_values).toMatchObject({ status: 'not_started' });
    expect(rows[1].new_values).toMatchObject({ status: 'in_progress' });
    expect(rows[2]).toMatchObject({ actor: 'claude', old_status: 'in_progress', new_status: 'done' });
    expect(rows[2].created_at).toBeInstanceOf(Date);
  });

  it('leaves out a change to the comment alone, and shows the owner only their own rows', async () => {
    const [step] = await admin<{ id: string }[]>`
      insert into plan_items (user_id, title) values (${owner}, 'Another') returning id`;
    await admin`update plan_items set comment = 'Started 12 Oct.' where id = ${step.id}`;
    expect((await historyOf(step.id)).map((r) => r.action)).toEqual(['insert']);

    const seen = await asUser(other, (tx) => tx`select id from plan_history`);
    expect(seen).toHaveLength(0);
    const mine = await asUser(owner, (tx) => tx`select id from plan_history`);
    expect(mine.length).toBeGreaterThan(0);
  });

  it('refuses a write to the history from a signed-in request', async () => {
    await expect(
      asUser(owner, (tx) => tx`delete from plan_history`),
    ).rejects.toThrow();
  });
});
