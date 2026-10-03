/**
 * A ref may only name a row of the account's own (plan #1450,
 * supabase/migrations/0156_ref_owned.sql).
 *
 * Done when a test with two users shows a ref to the other user's row is
 * refused on insert and one to the user's own row is accepted. Each table
 * that stores refs is tried both ways, under the person's own session where
 * the app writes it that way and with the service role where a run does.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asUser, closeDb, createUser, truncateAll } from './helpers/db-core';

let userA = '';
let userB = '';
let goalA = '';
let goalB = '';
let taskA = '';
let taskB = '';

async function newGoal(userId: string): Promise<string> {
  const [area] = await admin<{ id: string }[]>`
    insert into goals.areas (user_id, name) values (${userId}, 'Career') returning id`;
  const [goal] = await admin<{ id: string }[]>`
    insert into goals.items (user_id, level, area_id, title)
    values (${userId}, 'goal', ${area.id}, 'Land a finance role') returning id`;
  return goal.id;
}

async function newTask(userId: string): Promise<string> {
  const [task] = await admin<{ id: string }[]>`
    insert into todo.tasks (user_id, title) values (${userId}, 'Send the thank-you note') returning id`;
  return task.id;
}

beforeAll(async () => {
  await truncateAll();
  userA = await createUser('ref-owned-a@example.com');
  userB = await createUser('ref-owned-b@example.com');
  goalA = await newGoal(userA);
  goalB = await newGoal(userB);
  taskA = await newTask(userA);
  taskB = await newTask(userB);
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

describe('core.ref_owned', () => {
  it('is true for a row of the owner and false for anyone else', async () => {
    const [row] = await admin<{ mine: boolean; theirs: boolean }[]>`
      select core.ref_owned(${`goals.items:${goalA}`}, ${userA}) as mine,
             core.ref_owned(${`goals.items:${goalB}`}, ${userA}) as theirs`;
    expect(row).toEqual({ mine: true, theirs: false });
  });

  it('is false for a ref it cannot resolve', async () => {
    const refs = [
      'not a ref',
      'goals.items:',
      'goals.items:not-a-uuid',
      'goals.items:00000000-0000-0000-0000-000000000000',
      `nowhere.items:${goalA}`,
      `goals.items;select 1:${goalA}`,
    ];
    for (const ref of refs) {
      const [row] = await admin<{ owned: boolean }[]>`select core.ref_owned(${ref}, ${userA}) as owned`;
      expect(row.owned, ref).toBe(false);
    }
  });

  it('cannot be called by a signed-in person', async () => {
    await expect(
      asUser(userA, (tx) => tx`select core.ref_owned(${`goals.items:${goalB}`}, ${userB})`),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('a file’s origin', () => {
  const insert = (userId: string, origin: string) =>
    asUser(
      userId,
      (tx) => tx`insert into core.files (user_id, title, body, made_by, origin)
                 values (${userId}, 'Applications by role family', '283 since March.', 'you', ${origin})
                 returning id`,
    );

  it('accepts a row of the person’s own', async () => {
    await expect(insert(userA, `goals.items:${goalA}`)).resolves.toHaveLength(1);
  });

  it('refuses another account’s row, even with its real id', async () => {
    await expect(insert(userA, `goals.items:${goalB}`)).rejects.toThrow(/not a row of yours/);
  });

  it('refuses it on an update too', async () => {
    const [{ id }] = await insert(userA, `goals.items:${goalA}`);
    await expect(
      asUser(userA, (tx) => tx`update core.files set origin = ${`goals.items:${goalB}`} where id = ${id}`),
    ).rejects.toThrow(/not a row of yours/);
  });
});

describe('an observation’s evidence', () => {
  const insert = (userId: string, evidence: string[], position: number) =>
    admin`insert into core.observations (user_id, week, position, sentence, evidence, modules, model)
          values (${userId}, '2026-09-28', ${position}, 'You closed 2 tasks the week of a goal step.',
                  ${evidence}, ${['todo', 'goals']}, 'claude-sonnet-5')`;

  it('accepts rows of the person’s own', async () => {
    await expect(insert(userA, [`todo.tasks:${taskA}`, `goals.items:${goalA}`], 1)).resolves.toBeDefined();
  });

  it('refuses one row of another account among the person’s own', async () => {
    await expect(insert(userA, [`todo.tasks:${taskA}`, `todo.tasks:${taskB}`], 2)).rejects.toThrow(
      /todo.tasks:.* is not a row of yours/,
    );
  });

  it('still lets the verdict change after a cited row is gone', async () => {
    const task = await newTask(userA);
    const [row] = await admin<{ id: string }[]>`
      insert into core.observations (user_id, week, position, sentence, evidence, modules)
      values (${userA}, '2026-09-21', 1, 'One task, 1.', ${[`todo.tasks:${task}`, `goals.items:${goalA}`]},
              ${['todo', 'goals']})
      returning id`;
    await admin`delete from todo.tasks where id = ${task}`;
    const updated = await asUser(
      userA,
      (tx) => tx`update core.observations set verdict = 'useful', verdict_at = now() where id = ${row.id} returning id`,
    );
    expect(updated).toHaveLength(1);
  });
});

describe('a review’s evidence', () => {
  const paragraphs = (ref: string) => JSON.stringify([{ topic: 'todo', text: 'You closed 1 task.', evidence: [ref] }]);
  const observations = (ref: string) => JSON.stringify([{ text: 'You closed 1 task.', goal_id: null, evidence: [ref] }]);

  it('accepts a year review citing the person’s own rows and refuses one citing another’s', async () => {
    const write = (year: number, ref: string) =>
      asUser(
        userA,
        (tx) => tx`insert into core.year_reviews (user_id, year, timezone, through, totals, paragraphs, model)
                   values (${userA}, ${year}, 'UTC', now(), '{}'::jsonb, ${paragraphs(ref)}::text::jsonb, 'claude-sonnet-5')`,
      );
    await expect(write(2024, `todo.tasks:${taskA}`)).resolves.toBeDefined();
    await expect(write(2025, `todo.tasks:${taskB}`)).rejects.toThrow(/not a row of yours/);
  });

  it('accepts a week review citing the person’s own rows and refuses one citing another’s', async () => {
    const write = (week: string, ref: string) =>
      admin`insert into core.week_reviews (user_id, week, facts, observations, source, model)
            values (${userA}, ${week}, '{}'::jsonb, ${observations(ref)}::text::jsonb, 'model', 'claude-sonnet-5')`;
    await expect(write('2026-09-20', `todo.tasks:${taskA}`)).resolves.toBeDefined();
    await expect(write('2026-09-27', `todo.tasks:${taskB}`)).rejects.toThrow(/not a row of yours/);
  });
});
