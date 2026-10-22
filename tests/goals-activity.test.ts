/**
 * Whether a goal is active or passive (plan #2503.1, goals migration 0086).
 *
 * Only a goal carries the label. The database holds that for every writer, so
 * a step cannot be given one however it is written.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, closeDb, createUser, truncateAll } from './helpers/db-goals';

let userId = '';
let areaId = '';
let goalId = '';

beforeAll(async () => {
  await truncateAll();
  userId = await createUser('goals-activity@example.com');
  const [area] = await admin<{ id: string }[]>`
    insert into areas (user_id, name) values (${userId}, 'Home') returning id`;
  areaId = area.id;
  const [goal] = await admin<{ id: string }[]>`
    insert into items (user_id, level, area_id, title)
    values (${userId}, 'goal', ${areaId}, 'Keep the house standing') returning id`;
  goalId = goal.id;
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

describe('goal activity', () => {
  it('gives a new goal active and leaves a step without a label', async () => {
    const [goal] = await admin<{ activity: string | null }[]>`
      select activity from items where id = ${goalId}`;
    expect(goal.activity).toBe('active');
    const [step] = await admin<{ activity: string | null }[]>`
      insert into items (user_id, level, parent_id, kind, title)
      values (${userId}, 'step', ${goalId}, 'mine', 'Book the service') returning activity`;
    expect(step.activity).toBeNull();
  });

  it('takes passive on a goal and refuses any other word', async () => {
    await admin`update items set activity = 'passive' where id = ${goalId}`;
    const [row] = await admin<{ activity: string }[]>`select activity from items where id = ${goalId}`;
    expect(row.activity).toBe('passive');
    await expect(admin`update items set activity = 'sleeping' where id = ${goalId}`).rejects.toThrow(
      /items_activity_ck/,
    );
  });

  it('refuses a label on a step', async () => {
    await expect(
      admin`insert into items (user_id, level, parent_id, kind, title, activity)
        values (${userId}, 'step', ${goalId}, 'mine', 'Labelled step', 'passive')`,
    ).rejects.toThrow(/items_activity_ck/);
    const [step] = await admin<{ id: string }[]>`
      insert into items (user_id, level, parent_id, kind, title)
      values (${userId}, 'step', ${goalId}, 'mine', 'Plain step') returning id`;
    await expect(admin`update items set activity = 'active' where id = ${step.id}`).rejects.toThrow(
      /items_activity_ck/,
    );
  });
});
