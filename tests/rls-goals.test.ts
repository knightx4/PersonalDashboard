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
import type postgres from 'postgres';
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

  it('keeps the visit record to its owner (plan #1019)', async () => {
    await asUser(userA, (tx) => tx`
      insert into visits (user_id, last_visit_at) values (${userA}, now())
      on conflict (user_id) do update set last_visit_at = excluded.last_visit_at`);
    const theirs = await asUser(userB, (tx) => tx<{ user_id: string }[]>`select user_id from visits`);
    expect(theirs).toEqual([]);
    await expect(
      asUser(userB, (tx) => tx`insert into visits (user_id) values (${userA})`),
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

  it('gives a unit and target to goals only, and no target without a unit', async () => {
    await expect(
      admin`insert into items (user_id, level, parent_id, kind, title, unit)
            values (${userA}, 'step', ${goalA}, 'mine', 'Weigh in', 'lb')`,
    ).rejects.toThrow(/items_unit_ck/);
    await expect(
      admin`insert into items (user_id, level, area_id, title, target)
            values (${userA}, 'goal', ${areaA}, 'Bench more', 225)`,
    ).rejects.toThrow(/items_target_ck/);
    const [row] = await admin<{ id: string }[]>`
      insert into items (user_id, level, area_id, title, unit, target)
      values (${userA}, 'goal', ${areaA}, 'Bench more', 'lb', 225) returning id`;
    expect(row.id).toBeTruthy();
  });

  it('never overwrites a reading, but lets its note change and the row go', async () => {
    const [reading] = await asUser(userA, (tx) => tx<{ id: string }[]>`
      insert into readings (user_id, item_id, value, read_on)
      values (${userA}, ${goalA}, 4200, '2026-09-01') returning id`);
    await expect(
      asUser(userA, (tx) => tx`update readings set value = 4100 where id = ${reading.id}`),
    ).rejects.toThrow(/never overwritten/);
    await expect(
      asUser(userA, (tx) => tx`update readings set read_on = '2026-09-02' where id = ${reading.id}`),
    ).rejects.toThrow(/never overwritten/);
    await asUser(userA, (tx) => tx`update readings set note = 'after payday' where id = ${reading.id}`);
    await asUser(userA, (tx) => tx`delete from readings where id = ${reading.id}`);
    const rows = await historyOf(reading.id);
    expect(rows.map((r) => r.action)).toEqual(['insert', 'update', 'delete']);
  });
});

describe('goals step tree', () => {
  it('nests steps under steps, and records closing, reopening and archiving one', async () => {
    const [first] = await admin<{ id: string }[]>`
      insert into items (user_id, level, parent_id, kind, title)
      values (${userA}, 'step', ${goalA}, 'mine', 'Work out the payoff order') returning id`;
    const [second] = await admin<{ id: string }[]>`
      insert into items (user_id, level, parent_id, kind, title)
      values (${userA}, 'step', ${first.id}, 'claude', 'Compare avalanche and snowball')
      returning id`;
    const [third] = await admin<{ id: string }[]>`
      insert into items (user_id, level, parent_id, kind, title)
      values (${userA}, 'step', ${second.id}, 'decision', 'Lowest balance or highest rate?')
      returning id`;

    await asUser(userA, (tx) => tx`update items set status = 'done' where id = ${third.id}`);
    await asUser(userA, (tx) => tx`update items set status = 'open' where id = ${third.id}`);
    await asUser(userA, (tx) => tx`update items set archived_at = now() where id = ${third.id}`);

    const rows = await historyOf(third.id);
    expect(rows.map((r) => r.action)).toEqual(['insert', 'update', 'update', 'archive']);
    expect(rows[1].new_values).toMatchObject({ status: 'done' });
    expect(rows[2].new_values).toMatchObject({ status: 'open', closed_at: null });
  });

  it('links a step to a second goal, with history, and never to its own', async () => {
    const [cityArea] = await admin<{ id: string }[]>`
      insert into areas (user_id, name) values (${userA}, 'The city') returning id`;
    const [city] = await admin<{ id: string }[]>`
      insert into items (user_id, level, area_id, title)
      values (${userA}, 'goal', ${cityArea.id}, 'Get plugged into city life') returning id`;
    const [parent] = await admin<{ id: string }[]>`
      insert into items (user_id, level, parent_id, kind, title)
      values (${userA}, 'step', ${goalA}, 'mine', 'Cut spending') returning id`;
    const [step] = await admin<{ id: string }[]>`
      insert into items (user_id, level, parent_id, kind, title)
      values (${userA}, 'step', ${parent.id}, 'mine', 'Find free events') returning id`;

    const link = await asUser(userA, async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        insert into item_goals (user_id, item_id, goal_id)
        values (${userA}, ${step.id}, ${city.id}) returning id`;
      return row.id;
    });
    const rows = await historyOf(link);
    expect(rows[0]).toMatchObject({ table_name: 'item_goals', action: 'insert', actor: 'me' });

    // The goal it already sits under, two levels up, is refused.
    await expect(
      asUser(userA, (tx) => tx`
        insert into item_goals (user_id, item_id, goal_id)
        values (${userA}, ${step.id}, ${goalA})`),
    ).rejects.toThrow(/already sits under that goal/);
    // A goal is not a step, and a step is not a goal.
    await expect(
      admin`insert into item_goals (user_id, item_id, goal_id)
            values (${userA}, ${goalA}, ${city.id})`,
    ).rejects.toThrow(/is not a step/);
    await expect(
      admin`insert into item_goals (user_id, item_id, goal_id)
            values (${userA}, ${step.id}, ${parent.id})`,
    ).rejects.toThrow(/is not a goal/);
  });

  it('refuses a link to another account\'s goal', async () => {
    const [areaB] = await admin<{ id: string }[]>`
      insert into areas (user_id, name) values (${userB}, 'Health') returning id`;
    const [goalB] = await admin<{ id: string }[]>`
      insert into items (user_id, level, area_id, title)
      values (${userB}, 'goal', ${areaB.id}, 'Run a 10k') returning id`;
    const [step] = await admin<{ id: string }[]>`
      insert into items (user_id, level, parent_id, kind, title)
      values (${userA}, 'step', ${goalA}, 'mine', 'Walk to work') returning id`;
    await expect(
      asUser(userA, (tx) => tx`
        insert into item_goals (user_id, item_id, goal_id)
        values (${userA}, ${step.id}, ${goalB.id})`),
      // The shape trigger reads under row level security, so it cannot see the
      // other account's goal and refuses first; the composite key would too.
    ).rejects.toThrow(/is not a goal|item_goals_goal_fk/);
  });
});

describe('goals links', () => {
  it('links a goal to a Learn aim and the job search, with history', async () => {
    const [aim] = await admin<{ id: string }[]>`
      insert into learn.aims (user_id, name) values (${userA}, 'Urban planning basics')
      returning id`;

    const link = await asUser(userA, async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        insert into links (user_id, item_id, kind, target_id)
        values (${userA}, ${goalA}, 'aim', ${aim.id}) returning id`;
      await tx`
        insert into links (user_id, item_id, kind) values (${userA}, ${goalA}, 'job_search')`;
      return row.id;
    });
    const rows = await historyOf(link);
    expect(rows[0]).toMatchObject({ table_name: 'links', action: 'insert', actor: 'me' });

    // The job search has no target, and a goal holds it once.
    await expect(
      admin`insert into links (user_id, item_id, kind) values (${userA}, ${goalA}, 'job_search')`,
    ).rejects.toThrow(/links_target_key/);
    await expect(
      admin`insert into links (user_id, item_id, kind, target_id)
            values (${userA}, ${goalA}, 'job_search', ${aim.id})`,
    ).rejects.toThrow(/links_target_ck/);

    // Unlinking an aim Learn has since archived is still allowed.
    await admin`update learn.aims set archived_at = now() where id = ${aim.id}`;
    await asUser(userA, (tx) => tx`update links set archived_at = now() where id = ${link}`);
    // Bringing it back is not, while the aim is archived.
    await expect(
      asUser(userA, (tx) => tx`update links set archived_at = null where id = ${link}`),
    ).rejects.toThrow(/no aim/);
  });

  it("refuses a link to another account's aim or a target that does not exist", async () => {
    const [aimB] = await admin<{ id: string }[]>`
      insert into learn.aims (user_id, name) values (${userB}, 'Their aim') returning id`;
    await expect(
      admin`insert into links (user_id, item_id, kind, target_id)
            values (${userA}, ${goalA}, 'aim', ${aimB.id})`,
    ).rejects.toThrow(/no aim/);
    await expect(
      asUser(userA, (tx) => tx`
        insert into links (user_id, item_id, kind, target_id)
        values (${userA}, ${goalA}, 'application', gen_random_uuid())`),
    ).rejects.toThrow(/no application/);
    // And the other account cannot see A's links at all.
    const seen = await asUser(userB, (tx) => tx`select id from links`);
    expect(seen).toHaveLength(0);
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

describe('approval once per goal (plan #932)', () => {
  /** A write the way the goals routine makes one: actor declared, no session. */
  async function asClaude<T>(fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
    return admin.begin(async (tx) => {
      await tx.unsafe(`set local goals.actor = 'claude'`);
      return fn(tx);
    }) as Promise<T>;
  }

  async function newGoal(title: string): Promise<string> {
    const [row] = await asUser(userA, (tx) => tx<{ id: string }[]>`
      insert into items (user_id, level, area_id, title, fog)
      values (${userA}, 'goal', ${areaA}, ${title}, 'Not sure what good looks like yet')
      returning id`);
    return row.id;
  }

  it('holds Claude to proposals and questions under a goal you have not approved', async () => {
    const goal = await newGoal('Have good relationships');
    await expect(
      asClaude((tx) => tx`
        insert into items (user_id, level, parent_id, kind, title)
        values (${userA}, 'step', ${goal}, 'mine', 'Call one friend a week')`),
    ).rejects.toThrow(/not approved yet/);

    const [step] = await asClaude((tx) => tx<{ id: string }[]>`
      insert into items (user_id, level, parent_id, kind, title, status)
      values (${userA}, 'step', ${goal}, 'mine', 'Call one friend a week', 'proposed')
      returning id`);
    const [question] = await asClaude((tx) => tx<{ id: string }[]>`
      insert into items (user_id, level, parent_id, kind, title, detail)
      values (${userA}, 'step', ${goal}, 'decision', 'Old friends or new ones first?',
              ${'A — Old friends.\nB — New ones.'})
      returning id`);

    await expect(
      asClaude((tx) => tx`update items set status = 'open' where id = ${step.id}`),
    ).rejects.toThrow(/only you can turn a proposed step/);
    await expect(
      asClaude((tx) => tx`update items set resolution = 'New' where id = ${question.id}`),
    ).rejects.toThrow(/may not answer a question/);
    await expect(
      asClaude((tx) => tx`update items set approved_at = now() where id = ${goal}`),
    ).rejects.toThrow(/may not approve/);

    const history = await historyOf(step.id);
    expect(history[0].actor).toBe('claude');
  });

  it('opens the goal and every proposed step beneath it when you approve', async () => {
    const goal = await newGoal('Get fit');
    const [parent] = await asClaude((tx) => tx<{ id: string }[]>`
      insert into items (user_id, level, parent_id, kind, title, status)
      values (${userA}, 'step', ${goal}, 'mine', 'Pick a gym', 'proposed') returning id`);
    await asClaude((tx) => tx`
      insert into items (user_id, level, parent_id, kind, title, status)
      values (${userA}, 'step', ${parent.id}, 'claude', 'Compare three gyms nearby', 'proposed')`);

    const [{ opened }] = await asUser(userA, (tx) =>
      tx<{ opened: number }[]>`select approve_goal(${goal}) as opened`,
    );
    expect(opened).toBe(2);

    const rows = await admin<{ status: string; approved: boolean }[]>`
      select status, approved_at is not null as approved from items
      where id = ${goal} or parent_id = ${goal} or parent_id = ${parent.id} order by level`;
    expect(rows).toEqual([
      { status: 'open', approved: true },
      { status: 'open', approved: false },
      { status: 'open', approved: false },
    ]);
    // Somebody else's goal is out of reach.
    const [{ none }] = await asUser(userB, (tx) =>
      tx<{ none: number | null }[]>`select approve_goal(${goal}) as none`,
    );
    expect(none).toBeNull();
  });

  it('lets Claude add and reorder under an approved goal, but not touch the done-when or your steps', async () => {
    const goal = await newGoal('Bench 200 lbs');
    const [mine] = await asUser(userA, (tx) => tx<{ id: string }[]>`
      insert into items (user_id, level, parent_id, kind, title)
      values (${userA}, 'step', ${goal}, 'mine', 'Test a one-rep max') returning id`);
    await asUser(userA, (tx) => tx`select approve_goal(${goal})`);

    const [added] = await asClaude((tx) => tx<{ id: string }[]>`
      insert into items (user_id, level, parent_id, kind, title, position)
      values (${userA}, 'step', ${goal}, 'claude', 'Write a twelve-week programme', 5)
      returning id`);
    await asClaude((tx) => tx`update items set position = 50 where id = ${mine.id}`);
    await asClaude((tx) => tx`update items set parent_id = ${added.id} where id = ${mine.id}`);

    await expect(
      asClaude((tx) => tx`update items set status = 'dropped' where id = ${mine.id}`),
    ).rejects.toThrow(/drop or archive one of your steps/);
    await expect(
      asClaude((tx) => tx`update items set archived_at = now() where id = ${mine.id}`),
    ).rejects.toThrow(/drop or archive one of your steps/);
    await expect(
      asClaude((tx) => tx`update items set acceptance = 'Bench 180' where id = ${goal}`),
    ).rejects.toThrow(/done-when/);
    await expect(
      asClaude((tx) => tx`
        insert into items (user_id, level, area_id, title)
        values (${userA}, 'goal', ${areaA}, 'Run a marathon')`),
    ).rejects.toThrow(/propose a goal but not add one/);
    const [proposal] = await asClaude((tx) => tx<{ id: string }[]>`
      insert into items (user_id, level, area_id, title, status)
      values (${userA}, 'goal', ${areaA}, 'Run a 10k', 'proposed') returning id`);
    expect(proposal.id).toBeTruthy();
  });
});

describe('Claude results on steps (plan #933)', () => {
  async function asClaude<T>(fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
    return admin.begin(async (tx) => {
      await tx.unsafe(`set local goals.actor = 'claude'`);
      return fn(tx);
    }) as Promise<T>;
  }

  it('stores a result on a Claude step, and only you mark it read', async () => {
    const [step] = await asUser(userA, (tx) => tx<{ id: string }[]>`
      insert into items (user_id, level, parent_id, kind, title)
      values (${userA}, 'step', ${goalA}, 'claude', 'List the three cheapest cards') returning id`);

    await asClaude((tx) => tx`
      update items set result = 'Card A at 0%', result_url = 'https://example.test/cards',
        status = 'done'
      where id = ${step.id}`);
    await expect(
      asClaude((tx) => tx`update items set reviewed_at = now() where id = ${step.id}`),
    ).rejects.toThrow(/mark a result reviewed/);

    await asUser(userA, (tx) => tx`update items set reviewed_at = now() where id = ${step.id}`);
    const [row] = await admin<{ status: string; read: boolean }[]>`
      select status, reviewed_at is not null as read from items where id = ${step.id}`;
    expect(row).toEqual({ status: 'done', read: true });

    const history = await historyOf(step.id);
    expect(history.map((h) => h.actor)).toEqual(['me', 'claude', 'me']);
  });

  it('keeps results to Claude steps and prepared steps of yours, with a link that is a web address', async () => {
    // A step of yours takes what Claude prepared for it (plan #1001), and stays open.
    const [mine] = await admin<{ id: string }[]>`
      insert into items (user_id, level, parent_id, kind, title)
      values (${userA}, 'step', ${goalA}, 'mine', 'Call the bank') returning id`;
    await admin`update items set result = '1. Call 1-800-555-0100.' where id = ${mine.id}`;
    const [prepared] = await admin<{ kind: string; status: string }[]>`
      select kind, status from items where id = ${mine.id}`;
    expect(prepared).toEqual({ kind: 'mine', status: 'open' });

    const [question] = await admin<{ id: string }[]>`
      insert into items (user_id, level, parent_id, kind, title)
      values (${userA}, 'step', ${goalA}, 'decision', 'Which bank?') returning id`;
    await expect(
      admin`update items set result = 'Done' where id = ${question.id}`,
    ).rejects.toThrow(/items_result_kind_ck/);

    const [claude] = await admin<{ id: string }[]>`
      insert into items (user_id, level, parent_id, kind, title)
      values (${userA}, 'step', ${goalA}, 'claude', 'Draft the letter') returning id`;
    await expect(
      admin`update items set result_url = 'javascript:alert(1)' where id = ${claude.id}`,
    ).rejects.toThrow(/items_result_url_ck/);
    await expect(
      admin`update items set reviewed_at = now() where id = ${claude.id}`,
    ).rejects.toThrow(/items_reviewed_at_ck/);
  });
});

describe('questions put aside and answers changed (plan #956)', () => {
  async function asClaude<T>(fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
    return admin.begin(async (tx) => {
      await tx.unsafe(`set local goals.actor = 'claude'`);
      return fn(tx);
    }) as Promise<T>;
  }

  it('lets only you put an unanswered question aside', async () => {
    const [question] = await asUser(userA, (tx) => tx<{ id: string }[]>`
      insert into items (user_id, level, parent_id, kind, title, detail)
      values (${userA}, 'step', ${goalA}, 'decision', 'Avalanche or snowball?',
              ${'A — Avalanche. Highest rate first.\nB — Snowball. Smallest balance first.'})
      returning id`);
    const [step] = await asUser(userA, (tx) => tx<{ id: string }[]>`
      insert into items (user_id, level, parent_id, kind, title)
      values (${userA}, 'step', ${goalA}, 'mine', 'Set up autopay') returning id`);

    await expect(
      asClaude((tx) => tx`update items set dismissed_at = now() where id = ${question.id}`),
    ).rejects.toThrow(/may not put a question aside/);
    await expect(
      asUser(userA, (tx) => tx`update items set dismissed_at = now() where id = ${step.id}`),
    ).rejects.toThrow(/items_dismissed_question_ck/);

    await asUser(userA, (tx) => tx`update items set dismissed_at = now() where id = ${question.id}`);
    await expect(
      asUser(userA, (tx) => tx`update items set resolution = 'A' where id = ${question.id}`),
    ).rejects.toThrow(/items_dismissed_question_ck/);
    await asUser(userA, (tx) => tx`
      update items set resolution = 'A', status = 'done', dismissed_at = null
      where id = ${question.id}`);
  });

  it('keeps the answer a change replaced in history', async () => {
    const [question] = await asUser(userA, (tx) => tx<{ id: string }[]>`
      insert into items (user_id, level, parent_id, kind, title, resolution, status)
      values (${userA}, 'step', ${goalA}, 'decision', 'Refinance?', 'A — Refinance', 'done')
      returning id`);
    await asUser(userA, (tx) => tx`
      update items set resolution = 'B — Keep the federal loans' where id = ${question.id}`);

    const history = await historyOf(question.id);
    const change = history.at(-1);
    expect(change?.action).toBe('update');
    expect(change?.old_values).toMatchObject({ resolution: 'A — Refinance' });
    expect(change?.new_values).toMatchObject({ resolution: 'B — Keep the federal loans' });
  });
});

describe('questions from Claude carry options (plan #962)', () => {
  async function asClaude<T>(fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
    return admin.begin(async (tx) => {
      await tx.unsafe(`set local goals.actor = 'claude'`);
      return fn(tx);
    }) as Promise<T>;
  }

  it('counts lettered options the way the page draws them', async () => {
    const counts = await admin<{ n: number }[]>`
      select lettered_options(d) as n from unnest(${[
        'A — Avalanche. Highest rate first.\nB — Snowball.\nRecommend A.',
        '(a) One\n(b) Two\n(c) Three',
        '  A. One\r\n  B: Two',
        'A fired session\nB is prose',
        'A -- One\nC -- Two',
        'A) Only one',
      ]}::text[]) as d`;
    expect(counts.map((row) => row.n)).toEqual([2, 3, 2, 0, 0, 0]);
  });

  it('refuses a question from Claude with fewer than two options, and leaves yours alone', async () => {
    await expect(
      asClaude((tx) => tx`
        insert into items (user_id, level, parent_id, kind, title)
        values (${userA}, 'step', ${goalA}, 'decision', 'Avalanche or snowball?')`),
    ).rejects.toThrow(/at least two options/);
    await expect(
      asClaude((tx) => tx`
        insert into items (user_id, level, parent_id, kind, title, detail)
        values (${userA}, 'step', ${goalA}, 'decision', 'Refinance?', ${'A — Refinance.'})`),
    ).rejects.toThrow(/at least two options/);

    const [question] = await asClaude((tx) => tx<{ id: string }[]>`
      insert into items (user_id, level, parent_id, kind, title, detail)
      values (${userA}, 'step', ${goalA}, 'decision', 'Avalanche or snowball?',
              ${'A — Avalanche. Highest rate first.\nB — Snowball. Smallest balance first.'})
      returning id`);
    await expect(
      asClaude((tx) => tx`update items set detail = 'Either works.' where id = ${question.id}`),
    ).rejects.toThrow(/at least two options/);
    await asClaude((tx) => tx`update items set position = 70 where id = ${question.id}`);

    const [yours] = await asUser(userA, (tx) => tx<{ id: string }[]>`
      insert into items (user_id, level, parent_id, kind, title)
      values (${userA}, 'step', ${goalA}, 'decision', 'Call the servicer or write?') returning id`);
    await asClaude((tx) => tx`update items set position = 80 where id = ${yours.id}`);
  });
});

describe('one proposal at a time, and fog put aside (plan #960)', () => {
  async function asClaude<T>(fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
    return admin.begin(async (tx) => {
      await tx.unsafe(`set local goals.actor = 'claude'`);
      return fn(tx);
    }) as Promise<T>;
  }

  async function propose(parent: string, title: string, kind = 'mine'): Promise<string> {
    const [row] = await asClaude((tx) => tx<{ id: string }[]>`
      insert into items (user_id, level, parent_id, kind, title, status)
      values (${userA}, 'step', ${parent}, ${kind}, ${title}, 'proposed') returning id`);
    return row.id;
  }

  it('approves one proposal with those beneath it and leaves the goal unapproved', async () => {
    const [goal] = await asUser(userA, (tx) => tx<{ id: string }[]>`
      insert into items (user_id, level, area_id, title)
      values (${userA}, 'goal', ${areaA}, 'Run a half marathon') returning id`);
    const parent = await propose(goal.id, 'Pick a plan');
    const child = await propose(parent, 'Compare three plans', 'claude');
    const other = await propose(goal.id, 'Buy shoes');

    const [{ settled }] = await asUser(userA, (tx) =>
      tx<{ settled: number }[]>`select settle_proposal(${parent}, true) as settled`,
    );
    expect(settled).toBe(2);
    const rows = await admin<{ id: string; status: string; approved_at: string | null }[]>`
      select id, status, approved_at from items where id in (${goal.id}, ${parent}, ${child}, ${other})`;
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
    expect(byId[parent].status).toBe('open');
    expect(byId[child].status).toBe('open');
    expect(byId[other].status).toBe('proposed');
    expect(byId[goal.id].approved_at).toBeNull();

    // Not a proposal any more, somebody else's, or asked by Claude.
    const [{ none }] = await asUser(userA, (tx) =>
      tx<{ none: number | null }[]>`select settle_proposal(${parent}, true) as none`,
    );
    expect(none).toBeNull();
    const [{ theirs }] = await asUser(userB, (tx) =>
      tx<{ theirs: number | null }[]>`select settle_proposal(${other}, true) as theirs`,
    );
    expect(theirs).toBeNull();
    await expect(
      asClaude((tx) => tx`select goals.settle_proposal(${other}, true)`),
    ).rejects.toThrow(/only you can turn a proposed step/);
  });

  it('drops a turned-down proposal, the proposals and open questions beneath it, with history', async () => {
    const [goal] = await asUser(userA, (tx) => tx<{ id: string }[]>`
      insert into items (user_id, level, area_id, title)
      values (${userA}, 'goal', ${areaA}, 'Learn to cook') returning id`);
    const step = await propose(goal.id, 'Take a knife skills class');
    const [question] = await asClaude((tx) => tx<{ id: string }[]>`
      insert into items (user_id, level, parent_id, kind, title, detail)
      values (${userA}, 'step', ${step}, 'decision', 'Weekday or weekend?',
              ${'A — Weekday.\nB — Weekend.'}) returning id`);

    const [{ settled }] = await asUser(userA, (tx) =>
      tx<{ settled: number }[]>`select settle_proposal(${step}, false) as settled`,
    );
    expect(settled).toBe(2);
    const rows = await admin<{ status: string }[]>`
      select status from items where id in (${step}, ${question.id})`;
    expect(rows.map((row) => row.status)).toEqual(['dropped', 'dropped']);
    const history = await historyOf(step);
    expect(history.at(-1)).toMatchObject({
      action: 'update',
      actor: 'me',
      old_values: { status: 'proposed' },
      new_values: { status: 'dropped' },
    });
  });

  it('lets only you put fog aside, and brings it back when the fog is rewritten', async () => {
    const [goal] = await asUser(userA, (tx) => tx<{ id: string }[]>`
      insert into items (user_id, level, area_id, title, fog)
      values (${userA}, 'goal', ${areaA}, 'Get fit', 'Strength or endurance?') returning id`);

    await expect(
      asClaude((tx) => tx`update items set fog_dismissed_at = now() where id = ${goal.id}`),
    ).rejects.toThrow(/may not put fog aside/);
    await expect(
      asUser(userA, (tx) => tx`update items set fog_dismissed_at = now() where id = ${goalA}`),
    ).rejects.toThrow(/items_fog_dismissed_ck/);

    await asUser(userA, (tx) => tx`update items set fog_dismissed_at = now() where id = ${goal.id}`);
    await asClaude((tx) => tx`update items set fog = 'Where are you starting from?' where id = ${goal.id}`);
    const [row] = await admin<{ fog_dismissed_at: string | null }[]>`
      select fog_dismissed_at from items where id = ${goal.id}`;
    expect(row.fog_dismissed_at).toBeNull();
  });
});

describe('weekly goal reviews (plan #1018)', () => {
  async function asClaude<T>(fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
    return admin.begin(async (tx) => {
      await tx.unsafe(`set local goals.actor = 'claude'`);
      return fn(tx);
    }) as Promise<T>;
  }

  it('takes a stalled verdict only with its proposed step, and records it as Claude’s', async () => {
    await expect(
      asClaude((tx) => tx`
        insert into reviews (user_id, item_id, verdict, reason, next_move)
        values (${userA}, ${goalA}, 'stalled', 'Nothing done since August.', 'Call the lender.')`),
    ).rejects.toThrow(/reviews_stalled_step_ck/);

    const [row] = await asClaude((tx) => tx<{ id: string }[]>`
      with step as (
        insert into items (user_id, level, parent_id, kind, title, status)
        values (${userA}, 'step', ${goalA}, 'mine', 'Call the lender', 'proposed')
        returning id
      )
      insert into reviews (user_id, item_id, verdict, reason, next_move, step_id)
      select ${userA}, ${goalA}, 'stalled', 'Nothing done since August.', 'Call the lender.', id
      from step
      returning id`);

    const history = await historyOf(row.id);
    expect(history).toEqual([
      expect.objectContaining({ table_name: 'reviews', action: 'insert', actor: 'claude' }),
    ]);
  });

  it('refuses a verdict outside the three', async () => {
    await expect(
      asClaude((tx) => tx`
        insert into reviews (user_id, item_id, verdict, reason, next_move)
        values (${userA}, ${goalA}, 'done', 'It is done.', 'Close it.')`),
    ).rejects.toThrow(/reviews_verdict_ck/);
  });

  it('lets you read your own verdicts and write none, and hides them from anyone else', async () => {
    await asClaude((tx) => tx`
      insert into reviews (user_id, item_id, verdict, reason, next_move)
      values (${userA}, ${goalA}, 'on_track', 'Two steps closed this week.', 'Pay the Visa.')`);

    const mine = await asUser(userA, (tx) => tx`select verdict from reviews where item_id = ${goalA}`);
    expect(mine.length).toBeGreaterThan(0);
    const theirs = await asUser(userB, (tx) => tx`select verdict from reviews`);
    expect(theirs).toHaveLength(0);

    await expect(
      asUser(userA, (tx) => tx`
        insert into reviews (user_id, item_id, verdict, reason, next_move)
        values (${userA}, ${goalA}, 'on_track', 'Mine.', 'Mine.')`),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('weekly suggestions (plan #934)', () => {
  async function asClaude<T>(fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
    return admin.begin(async (tx) => {
      await tx.unsafe(`set local goals.actor = 'claude'`);
      return fn(tx);
    }) as Promise<T>;
  }

  async function suggest(title: string): Promise<string> {
    const [row] = await asClaude((tx) => tx<{ id: string }[]>`
      insert into suggestions (user_id, kind, title, url, happens_on)
      values (${userA}, 'events', ${title}, 'https://example.test/e', '2026-10-01') returning id`);
    return row.id;
  }

  it('lets Claude suggest and mark an unanswered one ignored, and nothing more', async () => {
    await expect(
      asClaude((tx) => tx`
        insert into suggestions (user_id, kind, title, reaction, reacted_at)
        values (${userA}, 'events', 'A talk', 'going', now())`),
    ).rejects.toThrow(/may suggest but not react/);

    const talk = await suggest('A talk at the library');
    await expect(
      asClaude((tx) => tx`
        update suggestions set reaction = 'going', reacted_at = now() where id = ${talk}`),
    ).rejects.toThrow(/may not react/);

    await asClaude((tx) => tx`
      update suggestions set reaction = 'ignored', reacted_at = now() where id = ${talk}`);
    await expect(
      asClaude((tx) => tx`update suggestions set reaction = null, reacted_at = null where id = ${talk}`),
    ).rejects.toThrow(/may not react/);

    const history = await historyOf(talk);
    expect(history.map((h) => h.actor)).toEqual(['claude', 'claude']);
  });

  it('refuses a suggestion with no kind or a kind outside the set (plan #1028)', async () => {
    await expect(
      asClaude((tx) => tx`insert into suggestions (user_id, title) values (${userA}, 'A book')`),
    ).rejects.toThrow(/"kind"/);
    await expect(
      asClaude((tx) => tx`
        insert into suggestions (user_id, kind, title) values (${userA}, 'gigs', 'A gig')`),
    ).rejects.toThrow(/suggestions_kind_ck/);
    const [row] = await asClaude((tx) => tx<{ kind: string }[]>`
      insert into suggestions (user_id, kind, title) values (${userA}, 'reading', 'A book')
      returning kind`);
    expect(row.kind).toBe('reading');
  });

  it('records your going, not for me and whether you went on the row', async () => {
    const walk = await suggest('A walking tour');
    await asUser(userA, (tx) => tx`
      update suggestions set reaction = 'not_for_me', reacted_at = now() where id = ${walk}`);
    await asUser(userA, (tx) => tx`
      update suggestions set reaction = 'going', reacted_at = now() where id = ${walk}`);
    await expect(
      asClaude((tx) => tx`update suggestions set attended = true where id = ${walk}`),
    ).rejects.toThrow(/whether you went/);
    await asUser(userA, (tx) => tx`update suggestions set attended = true where id = ${walk}`);

    const [row] = await admin<{ reaction: string; attended: boolean }[]>`
      select reaction, attended from suggestions where id = ${walk}`;
    expect(row).toEqual({ reaction: 'going', attended: true });
    expect((await historyOf(walk)).map((h) => h.actor)).toEqual(['claude', 'me', 'me', 'me']);

    const others = await asUser(userB, (tx) => tx`
      update suggestions set reaction = 'going', reacted_at = now() where id = ${walk} returning id`);
    expect(others).toHaveLength(0);
  });
});

describe('collections and records (plan #953)', () => {
  const loans = [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'balance', label: 'Balance', type: 'money', tracked: true },
    { key: 'rate', label: 'Rate', type: 'percent' },
    { key: 'kind', label: 'Kind', type: 'choice', options: ['Federal', 'Private'] },
  ];
  let collection = '';

  beforeAll(async () => {
    const [row] = await asUser(userA, (tx) => tx<{ id: string; version: number }[]>`
      insert into collections (user_id, name, fields, version)
      values (${userA}, 'Loans', ${JSON.stringify(loans)}::text::jsonb, 7) returning id, version`);
    collection = row.id;
    expect(row.version).toBe(1);
    await asUser(userA, (tx) => tx`
      insert into collection_goals (user_id, collection_id, goal_id)
      values (${userA}, ${collection}, ${goalA})`);
  });

  async function addLoan(data: Record<string, unknown>): Promise<string> {
    const [row] = await asUser(userA, (tx) => tx<{ id: string }[]>`
      insert into records (user_id, collection_id, data)
      values (${userA}, ${collection}, ${JSON.stringify(data)}::text::jsonb) returning id`);
    return row.id;
  }

  it('refuses a value that breaks its definition, with the field named', async () => {
    await expect(addLoan({ name: 'Loan 1', rate: 'seven' })).rejects.toMatchObject({
      message: 'records: Rate must be a percentage',
      detail: 'rate',
      constraint_name: 'records_values',
    });
    await expect(addLoan({ balance: 18250.405 })).rejects.toThrow(/Balance must be an amount of money/);
    await expect(addLoan({ kind: 'State' })).rejects.toThrow(/Kind must be one of its options/);
    await expect(addLoan({ colour: 'blue' })).rejects.toThrow(/Loans has no field colour/);
    // Claude writing straight through SQL is held to the same check.
    await expect(
      admin`insert into records (user_id, collection_id, data)
            values (${userA}, ${collection}, '{"rate": "high"}'::jsonb)`,
    ).rejects.toThrow(/Rate must be a percentage/);
  });

  it('writes a reading when a tracked field changes, and only then', async () => {
    const loan = await addLoan({ name: 'Loan 1', balance: 18250.4, rate: 6.8 });
    await asUser(userA, (tx) => tx`
      update records set data = data || '{"rate": 7.1}'::jsonb where id = ${loan}`);
    await asUser(userA, (tx) => tx`
      update records set data = data || '{"balance": 18000}'::jsonb where id = ${loan}`);

    const readings = await admin<{ value: string; field: string; item_id: string | null }[]>`
      select value::text, field, item_id from readings where record_id = ${loan} order by created_at`;
    expect(readings).toEqual([
      { value: '18250.4', field: 'balance', item_id: null },
      { value: '18000', field: 'balance', item_id: null },
    ]);
    const history = await historyOf(loan);
    expect(history.map((h) => [h.table_name, h.action, h.actor])).toEqual([
      ['records', 'insert', 'me'],
      ['records', 'update', 'me'],
      ['records', 'update', 'me'],
    ]);
  });

  it('dates a reading by the document the record was read from (plan #985)', async () => {
    const [row] = await asUser(userA, (tx) => tx<{ id: string }[]>`
      insert into records (user_id, collection_id, data, as_of)
      values (${userA}, ${collection}, '{"name": "Loan 3", "balance": 900}'::jsonb, '2026-09-02')
      returning id`);
    // A second read of the same statement changes nothing and writes nothing.
    await asUser(userA, (tx) => tx`
      update records set data = data || '{"balance": 900}'::jsonb, as_of = '2026-09-02' where id = ${row.id}`);
    // Typed values carry no date and are read today.
    await asUser(userA, (tx) => tx`
      update records set data = data || '{"balance": 850}'::jsonb, as_of = null where id = ${row.id}`);
    const readings = await admin<{ value: string; dated: boolean; today: boolean }[]>`
      select value::text, read_on = date '2026-09-02' as dated, read_on = current_date as today
      from readings where record_id = ${row.id} order by created_at`;
    expect(readings).toEqual([
      { value: '900', dated: true, today: false },
      { value: '850', dated: false, today: true },
    ]);
  });

  it('holds a collection to one ID field, of text or a number (plan #985)', async () => {
    const fields = (extra: object) =>
      JSON.stringify([{ key: 'loan_id', label: 'Loan ID', type: 'text', id: true }, extra]);
    await expect(
      asUser(userA, (tx) => tx`
        insert into collections (user_id, name, fields)
        values (${userA}, 'Two IDs', ${fields({ key: 'n', label: 'N', type: 'number', id: true })}::text::jsonb)`),
    ).rejects.toThrow(/at most one ID field/);
    await expect(
      asUser(userA, (tx) => tx`
        insert into collections (user_id, name, fields)
        values (${userA}, 'Money ID', ${JSON.stringify([{ key: 'm', label: 'M', type: 'money', id: true }])}::text::jsonb)`),
    ).rejects.toThrow(/only a text or number field can be the ID/);
  });

  it('raises the version on a definition change and keeps old records intact', async () => {
    const loan = await addLoan({ name: 'Loan 2', kind: 'Federal' });
    const revised = [
      ...loans.map((f) => (f.key === 'kind' ? { ...f, options: ['Private'] } : f)),
      { key: 'due_day', label: 'Due day', type: 'day_of_month' },
    ];
    const [after] = await asUser(userA, (tx) => tx<{ version: number }[]>`
      update collections set fields = ${JSON.stringify(revised)}::text::jsonb, version = 1
      where id = ${collection} returning version`);
    expect(after.version).toBe(2);

    // The old answer is kept, and an edit to another field leaves it alone.
    await asUser(userA, (tx) => tx`
      update records set data = data || '{"due_day": 15}'::jsonb where id = ${loan}`);
    const [row] = await admin<{ data: Record<string, unknown>; version: number }[]>`
      select data, version from records where id = ${loan}`;
    expect(row).toEqual({ data: { name: 'Loan 2', kind: 'Federal', due_day: 15 }, version: 2 });

    await expect(
      asUser(userA, (tx) => tx`
        update collections set fields = ${JSON.stringify(loans.slice(1))}::text::jsonb where id = ${collection}`),
    ).rejects.toThrow(/cannot be taken out/);
    await expect(
      asUser(userA, (tx) => tx`
        update collections
        set fields = ${JSON.stringify(revised.map((f) => (f.key === 'rate' ? { ...f, type: 'number' } : f)))}::text::jsonb
        where id = ${collection}`),
    ).rejects.toThrow(/stays a percent/);
  });

  it('holds a one-record collection to one live record', async () => {
    const [budget] = await asUser(userA, (tx) => tx<{ id: string }[]>`
      insert into collections (user_id, name, shape, fields)
      values (${userA}, 'Budget', 'one', '[{"key": "rent", "label": "Rent", "type": "money"}]'::jsonb)
      returning id`);
    await asUser(userA, (tx) => tx`
      insert into records (user_id, collection_id, data) values (${userA}, ${budget.id}, '{"rent": 2100}'::jsonb)`);
    await expect(
      asUser(userA, (tx) => tx`
        insert into records (user_id, collection_id, data) values (${userA}, ${budget.id}, '{}'::jsonb)`),
    ).rejects.toThrow(/holds one record/);
  });

  it('points a step at a collection, and keeps confirming a draft yours (plan #954)', async () => {
    const [step] = await asUser(userA, (tx) => tx<{ id: string }[]>`
      insert into items (user_id, level, parent_id, kind, title, collection_id, asks_for)
      values (${userA}, 'step', ${goalA}, 'mine', 'List your loans', ${collection},
              array['name', 'balance'])
      returning id`);
    expect(step.id).toBeTruthy();
    await expect(
      asUser(userA, (tx) => tx`
        insert into items (user_id, level, area_id, title, collection_id)
        values (${userA}, 'goal', ${areaA}, 'Not a step', ${collection})`),
    ).rejects.toThrow(/items_collection_step_ck/);

    await expect(
      asUser(userA, (tx) => tx`
        insert into records (user_id, collection_id, data, draft)
        values (${userA}, ${collection}, '{}'::jsonb, true)`),
    ).rejects.toThrow(/records_draft_source_ck/);

    const asClaude = <T,>(fn: (tx: postgres.TransactionSql) => Promise<T>) =>
      admin.begin(async (tx) => {
        await tx.unsafe(`set local goals.actor = 'claude'`);
        return fn(tx);
      }) as Promise<T>;
    await expect(
      asClaude((tx) => tx`
        insert into records (user_id, collection_id, data, source)
        values (${userA}, ${collection}, '{"name": "Found"}'::jsonb, 'gmail')`),
    ).rejects.toThrow(/only as a draft/);
    const [draft] = await asClaude((tx) => tx<{ id: string }[]>`
      insert into records (user_id, collection_id, data, source, source_ref, draft)
      values (${userA}, ${collection}, '{"name": "Found"}'::jsonb, 'gmail', 'msg-1', true)
      returning id`);
    await expect(
      asClaude((tx) => tx`update records set draft = false where id = ${draft.id}`),
    ).rejects.toThrow(/may not confirm a draft/);
    const [confirmed] = await asUser(userA, (tx) => tx<{ draft: boolean; source: string }[]>`
      update records set draft = false where id = ${draft.id} returning draft, source`);
    expect(confirmed).toEqual({ draft: false, source: 'gmail' });
  });

  it("keeps each account's collections and records to itself", async () => {
    const seen = await asUser(userB, (tx) => tx`select id from records`);
    expect(seen).toHaveLength(0);
    await expect(
      asUser(userB, (tx) => tx`
        insert into records (user_id, collection_id, data) values (${userB}, ${collection}, '{}'::jsonb)`),
    ).rejects.toThrow();
    await expect(
      asUser(userB, (tx) => tx`
        insert into collection_goals (user_id, collection_id, goal_id)
        values (${userB}, ${collection}, ${goalA})`),
    ).rejects.toThrow();
  });
});

describe('comments on goals and steps (plan #957)', () => {
  async function asClaude<T>(fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
    return admin.begin(async (tx) => {
      await tx.unsafe(`set local goals.actor = 'claude'`);
      return fn(tx);
    }) as Promise<T>;
  }

  it('keeps a thread on a goal to its account, with history', async () => {
    const [comment] = await asUser(userA, (tx) => tx<{ id: string }[]>`
      insert into comments (user_id, item_id, author, body)
      values (${userA}, ${goalA}, 'me', '@dash which loan first?') returning id`);
    const history = await historyOf(comment.id);
    expect(history[0]).toMatchObject({ table_name: 'comments', action: 'insert', actor: 'me' });

    const seen = await asUser(userB, (tx) => tx`select id from comments where id = ${comment.id}`);
    expect(seen).toHaveLength(0);
    await expect(
      asUser(userB, (tx) => tx`
        insert into comments (user_id, item_id, author, body)
        values (${userB}, ${goalA}, 'me', 'not mine')`),
    ).rejects.toThrow();
  });

  it('lets Claude add its own replies and nothing else', async () => {
    const [mine] = await asUser(userA, (tx) => tx<{ id: string }[]>`
      insert into comments (user_id, item_id, author, body)
      values (${userA}, ${goalA}, 'me', 'A note') returning id`);

    await expect(
      asClaude((tx) => tx`
        insert into comments (user_id, item_id, author, body)
        values (${userA}, ${goalA}, 'me', 'Pretending to be you')`),
    ).rejects.toThrow(/only write its own replies/);
    await expect(
      asClaude((tx) => tx`delete from comments where id = ${mine.id}`),
    ).rejects.toThrow(/may not delete a comment you wrote/);

    const [reply] = await asClaude((tx) => tx<{ id: string }[]>`
      insert into comments (user_id, item_id, author, body)
      values (${userA}, ${goalA}, 'claude', 'Avalanche first.') returning id`);
    const history = await historyOf(reply.id);
    expect(history[0]).toMatchObject({ table_name: 'comments', actor: 'claude' });

    await asUser(userA, (tx) => tx`delete from comments where id = ${reply.id}`);
  });

  it('refuses an empty comment and one by nobody', async () => {
    await expect(
      asUser(userA, (tx) => tx`
        insert into comments (user_id, item_id, author, body) values (${userA}, ${goalA}, 'me', '  ')`),
    ).rejects.toThrow(/comments_body_ck/);
    await expect(
      asUser(userA, (tx) => tx`
        insert into comments (user_id, item_id, author, body) values (${userA}, ${goalA}, 'dash', 'hi')`),
    ).rejects.toThrow(/comments_author_ck/);
  });
});

describe('blocked steps and dependencies (plan #981)', () => {
  async function newStep(title: string, owner = userA, parent = goalA): Promise<string> {
    const [row] = await admin<{ id: string }[]>`
      insert into items (user_id, level, parent_id, kind, title)
      values (${owner}, 'step', ${parent}, 'mine', ${title}) returning id`;
    return row.id;
  }

  it('blocks a step with what it needs, and clears both when it is unblocked', async () => {
    const step = await newStep('Call the bank');
    await asUser(userA, (tx) => tx`
      update items set status = 'blocked', block_ask = 'The account number.' where id = ${step}`);
    const [blocked] = await admin<{ status: string; block_ask: string; block_kind: string }[]>`
      select status, block_ask, block_kind from items where id = ${step}`;
    expect(blocked).toEqual({ status: 'blocked', block_ask: 'The account number.', block_kind: 'outside' });

    await asUser(userA, (tx) => tx`update items set status = 'open' where id = ${step}`);
    const [open] = await admin<{ block_ask: string | null; block_kind: string | null }[]>`
      select block_ask, block_kind from items where id = ${step}`;
    expect(open).toEqual({ block_ask: null, block_kind: null });
  });

  it('never blocks a goal', async () => {
    await expect(
      admin`update items set status = 'blocked' where id = ${goalA}`,
    ).rejects.toThrow(/items_blocked_step_ck/);
  });

  it('records a dependency and refuses a loop, a goal and another account\'s step', async () => {
    const first = await newStep('Get the statement');
    const second = await newStep('Pay the card');
    const third = await newStep('Close the card');

    const [dep] = await asUser(userA, (tx) => tx<{ id: string }[]>`
      insert into dependencies (user_id, item_id, depends_on_id)
      values (${userA}, ${second}, ${first}) returning id`);
    const history = await historyOf(dep.id);
    expect(history[0]).toMatchObject({ table_name: 'dependencies', action: 'insert', actor: 'me' });
    await asUser(userA, (tx) => tx`
      insert into dependencies (user_id, item_id, depends_on_id) values (${userA}, ${third}, ${second})`);

    await expect(
      asUser(userA, (tx) => tx`
        insert into dependencies (user_id, item_id, depends_on_id) values (${userA}, ${first}, ${third})`),
    ).rejects.toThrow(/wait on each other/);
    await expect(
      asUser(userA, (tx) => tx`
        insert into dependencies (user_id, item_id, depends_on_id) values (${userA}, ${first}, ${goalA})`),
    ).rejects.toThrow(/steps of your own/);

    const [areaB] = await admin<{ id: string }[]>`
      insert into areas (user_id, name) values (${userB}, 'Theirs') returning id`;
    const [goalB] = await admin<{ id: string }[]>`
      insert into items (user_id, level, area_id, title)
      values (${userB}, 'goal', ${areaB.id}, 'Their goal') returning id`;
    const theirs = await newStep('Their step', userB, goalB.id);
    await expect(
      asUser(userA, (tx) => tx`
        insert into dependencies (user_id, item_id, depends_on_id) values (${userA}, ${first}, ${theirs})`),
    ).rejects.toThrow();
    const seen = await asUser(userB, (tx) => tx`select id from dependencies`);
    expect(seen).toHaveLength(0);
  });
});

describe('context from the other modules (0032)', () => {
  async function asClaude<T>(fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
    return admin.begin(async (tx) => {
      await tx.unsafe(`set local goals.actor = 'claude'`);
      return fn(tx);
    }) as Promise<T>;
  }

  async function newGoal(title: string, approved: boolean): Promise<string> {
    const [row] = await admin<{ id: string }[]>`
      insert into items (user_id, level, area_id, title, approved_at)
      values (${userA}, 'goal', ${areaA}, ${title}, ${approved ? new Date() : null})
      returning id`;
    return row.id;
  }

  function propose(goal: string, ref: string, status = 'proposed') {
    return asClaude((tx) => tx<{ id: string; decided_at: Date | null }[]>`
      insert into context (user_id, item_id, source, ref, title, why, status)
      values (${userA}, ${goal}, 'obsidian.notes', ${ref}, 'What I want next',
              'Says what you want from the next role.', ${status})
      returning id, decided_at`);
  }

  it('lets Claude propose, and keep only on an approved goal', async () => {
    const draft = await newGoal('Find a planning job', false);
    const [row] = await propose(draft, 'Career/What I want.md');
    expect(row.decided_at).toBeNull();
    await expect(propose(draft, 'Career/Other.md', 'kept')).rejects.toThrow(/not approved/);
    await expect(
      asClaude((tx) => tx`update context set status = 'kept' where id = ${row.id}`),
    ).rejects.toThrow(/only the person can keep/);

    const approved = await newGoal('Find a planning job, approved', true);
    const [kept] = await propose(approved, 'Career/What I want.md', 'kept');
    expect(kept.decided_at).not.toBeNull();
  });

  it('leaves dismissing to the person, and a dismissal stays', async () => {
    const goal = await newGoal('Change careers', false);
    const [row] = await propose(goal, 'Career/Dismissed.md');
    await expect(
      asClaude((tx) => tx`update context set status = 'dismissed' where id = ${row.id}`),
    ).rejects.toThrow(/dismissing is the person/);

    await asUser(userA, (tx) => tx`update context set status = 'dismissed' where id = ${row.id}`);
    await expect(
      asClaude((tx) => tx`update context set why = 'Try again' where id = ${row.id}`),
    ).rejects.toThrow(/dismissed this context/);
    await expect(
      asClaude((tx) => tx`delete from context where id = ${row.id}`),
    ).rejects.toThrow(/withdraw only its own proposals/);
    // The same note cannot come back as a second row.
    await expect(propose(goal, 'Career/Dismissed.md')).rejects.toThrow(/context_ref_key/);
  });

  it('belongs on a goal, and only to its owner', async () => {
    const goal = await newGoal('Get plugged into the city', false);
    const [step] = await admin<{ id: string }[]>`
      insert into items (user_id, level, parent_id, kind, title)
      values (${userA}, 'step', ${goal}, 'mine', 'Go to a board meeting') returning id`;
    await expect(propose(step.id, 'City/Boards.md')).rejects.toThrow(/belongs on a goal/);

    await propose(goal, 'City/Boards.md');
    const theirs = await asUser(userB, (tx) => tx`select id from context`);
    expect(theirs).toHaveLength(0);
    await expect(
      asUser(userB, (tx) => tx`
        insert into context (user_id, item_id, source, ref, title, why)
        values (${userB}, ${goal}, 'obsidian.notes', 'x.md', 'x', 'x')`),
    ).rejects.toThrow();
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

  // goals.visits (plan #1019) is the other exception: it changes on every
  // load of the home and records nothing done to a goal (migrations-goals/0027).
  it('records history on every table but history itself and visits', async () => {
    const tables = await admin<{ tablename: string }[]>`
      select c.relname as tablename
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'goals' and c.relkind = 'r' and c.relname not in ('history', 'visits')
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
      'collection_goals',
      'collections',
      'comments',
      'context',
      'dependencies',
      'item_goals',
      'items',
      'links',
      'periods',
      'readings',
      'records',
      'reviews',
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

describe('goals history of an undo', () => {
  it('records which change an undo took back, and only a change of your own', async () => {
    // Claude adds a step, as a routine's SQL does.
    const [step] = await admin<{ id: string }[]>`
      insert into items (user_id, level, parent_id, kind, title)
      values (${userA}, 'step', ${goalA}, 'claude', 'Added by a run') returning id`;
    const [added] = await admin<{ id: string }[]>`
      select id::text from history where row_id = ${step.id} and action = 'insert'`;

    // Undo on the run's page archives it on your session, naming the change.
    await asUser(userA, async (tx) => {
      await tx.unsafe(`set local goals.undoes = '${added.id}'`);
      await tx`update items set archived_at = now() where id = ${step.id}`;
    });
    const [undo] = await admin<{ action: string; actor: string; undoes: string | null; undoes_field: string | null }[]>`
      select action, actor, undoes::text, undoes_field from history
      where row_id = ${step.id} and action = 'archive'`;
    expect(undo).toEqual({ action: 'archive', actor: 'me', undoes: added.id, undoes_field: null });

    // A history id of another account is dropped rather than recorded.
    const [theirs] = await admin<{ id: string }[]>`
      insert into areas (user_id, name) values (${userB}, 'Theirs') returning id`;
    const [theirRow] = await admin<{ id: string }[]>`
      select id::text from history where row_id = ${theirs.id}`;
    await asUser(userA, async (tx) => {
      await tx.unsafe(`set local goals.undoes = '${theirRow.id}'`);
      await tx.unsafe(`set local goals.undoes_field = 'balance'`);
      await tx`update items set archived_at = null where id = ${step.id}`;
    });
    const [restore] = await admin<{ undoes: string | null; undoes_field: string | null }[]>`
      select undoes::text, undoes_field from history
      where row_id = ${step.id} and action = 'unarchive'`;
    expect(restore).toEqual({ undoes: null, undoes_field: null });
  });
});

describe('a goal’s number from its collection (plan #1024)', () => {
  const fields = [
    { key: 'name', label: 'Loan', type: 'text' },
    { key: 'balance', label: 'Balance', type: 'money', tracked: true },
  ];
  let goal = '';
  let collection = '';
  let first = '';
  let second = '';

  async function goalReadings() {
    return admin<{ value: string; read_on: string; note: string | null }[]>`
      select value::text, read_on::text, note from readings
      where item_id = ${goal} order by created_at`;
  }

  beforeAll(async () => {
    const [g] = await admin<{ id: string }[]>`
      insert into items (user_id, level, area_id, title, unit)
      values (${userA}, 'goal', ${areaA}, 'Clear the student loans', '$') returning id`;
    goal = g.id;
    const [c] = await asUser(userA, (tx) => tx<{ id: string }[]>`
      insert into collections (user_id, name, fields)
      values (${userA}, 'Student loans', ${JSON.stringify(fields)}::text::jsonb) returning id`);
    collection = c.id;
    const rows = await asUser(userA, (tx) => tx<{ id: string }[]>`
      insert into records (user_id, collection_id, data) values
        (${userA}, ${collection}, '{"name": "A", "balance": 80080.21}'::jsonb),
        (${userA}, ${collection}, '{"name": "B", "balance": 124304.41}'::jsonb)
      returning id`);
    [first, second] = rows.map((r) => r.id);
  });

  it('refuses a field the collection lacks, or a sum of text', async () => {
    await expect(
      asUser(userA, (tx) => tx`
        update items set number_from_collection_id = ${collection}, number_from_field = 'rate',
          number_from_how = 'sum' where id = ${goal}`),
    ).rejects.toThrow(/has no field rate/);
    await expect(
      asUser(userA, (tx) => tx`
        update items set number_from_collection_id = ${collection}, number_from_field = 'name',
          number_from_how = 'sum' where id = ${goal}`),
    ).rejects.toThrow(/Loan is not a number/);
    await expect(
      asUser(userA, (tx) => tx`
        update items set number_from_collection_id = ${collection}, number_from_how = 'sum'
        where id = ${goal}`),
    ).rejects.toThrow(/items_number_from_ck/);
  });

  it('reads the total when set, and a new one when a balance changes', async () => {
    await asUser(userA, (tx) => tx`
      update items set number_from_collection_id = ${collection}, number_from_field = 'balance',
        number_from_how = 'sum' where id = ${goal}`);
    const [now] = await admin<{ n: string }[]>`select goals.goal_number(${goal})::text as n`;
    expect(now.n).toBe('204384.62');

    // One statement touching both loans writes one reading, dated by the statement.
    await asUser(userA, (tx) => tx`
      update records set data = data || jsonb_build_object('balance',
        (data ->> 'balance')::numeric - 100), as_of = '2026-09-20'
      where id in (${first}, ${second})`);
    // An edit that leaves the total alone writes nothing.
    await asUser(userA, (tx) => tx`
      update records set data = data || '{"name": "A loan"}'::jsonb where id = ${first}`);
    // Archiving a loan takes it out of the total.
    await asUser(userA, (tx) => tx`update records set archived_at = now() where id = ${second}`);

    const readings = await goalReadings();
    expect(readings.map((r) => r.value)).toEqual(['204384.62', '204184.62', '79980.21']);
    expect(readings[1].read_on).toBe('2026-09-20');
    expect(readings[0].note).toBe('From Student loans: total balance');
  });

  it('counts records, and takes the newest value for latest', async () => {
    await asUser(userA, (tx) => tx`
      update items set number_from_how = 'count', number_from_field = null where id = ${goal}`);
    await asUser(userA, (tx) => tx`
      update items set number_from_how = 'latest', number_from_field = 'balance' where id = ${goal}`);
    const readings = await goalReadings();
    expect(readings.slice(-2).map((r) => r.value)).toEqual(['1', '79980.21']);
  });
});
