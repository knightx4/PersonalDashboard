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
      insert into items (user_id, level, parent_id, kind, title)
      values (${userA}, 'step', ${goal}, 'decision', 'Old friends or new ones first?')
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

  it('keeps results to Claude steps, with a link that is a web address', async () => {
    const [mine] = await admin<{ id: string }[]>`
      insert into items (user_id, level, parent_id, kind, title)
      values (${userA}, 'step', ${goalA}, 'mine', 'Call the bank') returning id`;
    await expect(
      admin`update items set result = 'Done' where id = ${mine.id}`,
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
      'item_goals',
      'items',
      'links',
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
