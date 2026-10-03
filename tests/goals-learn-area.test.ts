/**
 * Learning goals as goals in a Learn area (goals 0066, plan #1490).
 *
 * The goal owns a learning goal's wording and whether it is active; learn.aims
 * keeps what only Learn needs and follows the goal through aims.goal_id. These
 * tests hold the triggers to that: an edit on /goals reaches Learn, and the
 * writers that still go to learn.aims directly reach the goal.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asUser, closeDb, createUser, truncateAll } from './helpers/db-goals';

type AimRow = {
  id: string;
  name: string;
  about: string | null;
  archived_at: string | null;
  goal_id: string | null;
  placed_at: string | null;
};

let userA = '';

async function aimOfGoal(goalId: string): Promise<AimRow | undefined> {
  const [row] = await admin<AimRow[]>`
    select id, name, about, archived_at, goal_id, placed_at from learn.aims where goal_id = ${goalId}`;
  return row;
}

/** An aim written straight to learn.aims, with the goal its trigger gave it. */
async function insertAim(name: string, about: string | null = null): Promise<{ id: string; goal_id: string }> {
  // The goal is made after the insert, so `returning` cannot see it yet.
  const [row] = await admin<{ id: string }[]>`
    insert into learn.aims (user_id, name, about) values (${userA}, ${name}, ${about}) returning id`;
  const [linked] = await admin<{ id: string; goal_id: string }[]>`
    select id, goal_id from learn.aims where id = ${row.id}`;
  return linked;
}

async function learnArea(userId: string): Promise<string> {
  const [row] = await admin<{ id: string }[]>`
    select id from goals.areas where user_id = ${userId} and learn`;
  return row.id;
}

beforeAll(async () => {
  await truncateAll();
  userA = await createUser('learn-area-a@example.com');
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

describe('learning goals in the Learn area', () => {
  it('gives a new aim a goal in a Learn area, approved and linked', async () => {
    const aim = await asUser(userA, async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        insert into learn.aims (user_id, name, about, depth)
        values (${userA}, 'Corporate strategy', 'Frameworks and how to use them', 'solid')
        returning id`;
      return row.id;
    });

    const [goal] = await admin<
      { id: string; title: string; acceptance: string | null; status: string; approved_at: string | null; area_id: string }[]
    >`
      select g.id, g.title, g.acceptance, g.status, g.approved_at, g.area_id
      from goals.items g join learn.aims a on a.goal_id = g.id where a.id = ${aim}`;
    expect(goal).toMatchObject({
      title: 'Corporate strategy',
      acceptance: 'Frameworks and how to use them',
      status: 'open',
    });
    expect(goal.approved_at).not.toBeNull();

    const [area] = await admin<{ id: string; name: string }[]>`
      select id, name from goals.areas where user_id = ${userA} and learn`;
    expect(area.name).toBe('Learn');
    expect(goal.area_id).toBe(area.id);

    const links = await admin`
      select 1 from goals.links where item_id = ${goal.id} and kind = 'aim' and target_id = ${aim}`;
    expect(links).toHaveLength(1);

    // A second aim goes in the same area.
    await admin`insert into learn.aims (user_id, name) values (${userA}, 'SaaS metrics')`;
    const areas = await admin`select 1 from goals.areas where user_id = ${userA} and learn`;
    expect(areas).toHaveLength(1);
  });

  it('carries an edit to the goal into what Learn steers by, and clears the placement', async () => {
    const aim = await insertAim('Financial modeling', 'Three-statement models');
    // Placed, as the placement call would leave it.
    const [field] = await admin<{ id: string }[]>`select id from learn.area_fields limit 1`;
    if (field) {
      await admin`
        update learn.aims set field_id = ${field.id}, placement_confidence = 'clear',
          placement_basis = 'Finance', placement_model = 'test', placed_at = now()
        where id = ${aim.id}`;
    }

    await asUser(userA, (tx) => tx`
      update goals.items set title = 'Financial modeling for operators',
        acceptance = 'Driver-based models others can audit' where id = ${aim.goal_id}`);

    const after = await aimOfGoal(aim.goal_id);
    expect(after).toMatchObject({
      id: aim.id,
      name: 'Financial modeling for operators',
      about: 'Driver-based models others can audit',
      placed_at: null,
      archived_at: null,
    });

    // An emptied done-when is no line.
    await asUser(userA, (tx) => tx`update goals.items set acceptance = null where id = ${aim.goal_id}`);
    expect((await aimOfGoal(aim.goal_id))?.about).toBeNull();
  });

  it('stops steering by a goal that is parked, closed or archived, and starts again when it is reopened', async () => {
    const aim = await insertAim('Payments');

    await asUser(userA, (tx) => tx`update goals.items set status = 'parked' where id = ${aim.goal_id}`);
    expect((await aimOfGoal(aim.goal_id))?.archived_at).not.toBeNull();

    await asUser(userA, (tx) => tx`update goals.items set status = 'open' where id = ${aim.goal_id}`);
    expect((await aimOfGoal(aim.goal_id))?.archived_at).toBeNull();

    await asUser(userA, (tx) => tx`update goals.items set status = 'done' where id = ${aim.goal_id}`);
    expect((await aimOfGoal(aim.goal_id))?.archived_at).not.toBeNull();
    // Done stays done: the aim's archive does not archive the goal on top.
    const [goal] = await admin<{ status: string; archived_at: string | null }[]>`
      select status, archived_at from goals.items where id = ${aim.goal_id}`;
    expect(goal).toMatchObject({ status: 'done', archived_at: null });
  });

  it('makes a learning goal of a goal added to the Learn area', async () => {
    const area = await learnArea(userA);
    const goalId = await asUser(userA, async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        insert into goals.items (user_id, level, area_id, title, acceptance)
        values (${userA}, 'goal', ${area}, 'Bank regulation', 'Basel III in plain words') returning id`;
      return row.id;
    });

    const aim = await aimOfGoal(goalId);
    expect(aim).toMatchObject({ name: 'Bank regulation', about: 'Basel III in plain words', archived_at: null });
    const links = await admin`
      select 1 from goals.links where item_id = ${goalId} and kind = 'aim' and target_id = ${aim!.id}`;
    expect(links).toHaveLength(1);

    // A goal in another area is not one.
    const [other] = await admin<{ id: string }[]>`
      insert into goals.areas (user_id, name) values (${userA}, 'Money') returning id`;
    const otherGoal = await asUser(userA, async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        insert into goals.items (user_id, level, area_id, title)
        values (${userA}, 'goal', ${other.id}, 'Pay off the card') returning id`;
      return row.id;
    });
    expect(await aimOfGoal(otherGoal)).toBeUndefined();

    // Moving the learning goal out of the Learn area stops it steering Learn.
    await asUser(userA, (tx) => tx`update goals.items set area_id = ${other.id} where id = ${goalId}`);
    expect((await aimOfGoal(goalId))?.archived_at).not.toBeNull();
  });

  it("carries a rename or archive made on Learn's own page to the goal", async () => {
    const aim = await insertAim('Unit economics');

    await asUser(userA, (tx) => tx`
      update learn.aims set name = 'Unit economics of software', about = 'CAC payback' where id = ${aim.id}`);
    const [renamed] = await admin<{ title: string; acceptance: string | null }[]>`
      select title, acceptance from goals.items where id = ${aim.goal_id}`;
    expect(renamed).toEqual({ title: 'Unit economics of software', acceptance: 'CAC payback' });

    await asUser(userA, (tx) => tx`update learn.aims set archived_at = now() where id = ${aim.id}`);
    const [archived] = await admin<{ archived_at: string | null }[]>`
      select archived_at from goals.items where id = ${aim.goal_id}`;
    expect(archived.archived_at).not.toBeNull();
  });

  it('keeps a goal title longer than an aim name whole on the goal', async () => {
    const long = `Know ${'the market '.repeat(30)}`.trim();
    const aim = await insertAim('Short');
    await asUser(userA, (tx) => tx`update goals.items set title = ${long} where id = ${aim.goal_id}`);

    expect((await aimOfGoal(aim.goal_id))?.name).toBe(long.slice(0, 200));
    const [goal] = await admin<{ title: string }[]>`select title from goals.items where id = ${aim.goal_id}`;
    expect(goal.title).toBe(long);
  });
});
