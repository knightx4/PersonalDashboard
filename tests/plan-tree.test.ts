/**
 * The plan's shape, as the database keeps it.
 *
 * `lib/plan/tree.ts` reads the tree; these are the rules that keep it a tree
 * in the first place, and they live in triggers so that the page, the CLI and
 * a hand-typed query all meet the same refusal. Each one is exercised as the
 * signed-in user rather than as the superuser, because the parent and
 * dependency checks read under the caller's own policies -- and "another
 * account's step" and "no such step" have to come out the same.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, closeDb, createUser, truncateAll } from './helpers/db';

let alice: string;
let bob: string;

async function addStep(
  userId: string,
  title: string,
  over: { parentId?: string | null; status?: string } = {},
): Promise<{ id: string; number: number }> {
  return asUser(userId, async (tx) => {
    const [row] = await tx<{ id: string; number: number }[]>`
      insert into plan_items (user_id, title, parent_id, status)
      values (${userId}, ${title}, ${over.parentId ?? null}, ${over.status ?? 'not_started'})
      returning id, number`;
    return row;
  });
}

beforeAll(async () => {
  await truncateAll();
  alice = await createUser('plan-alice@example.com');
  bob = await createUser('plan-bob@example.com');
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

describe('numbering', () => {
  it('hands each account its own sequence, starting at one', async () => {
    const a1 = await addStep(alice, 'Alice one');
    const a2 = await addStep(alice, 'Alice two');
    const b1 = await addStep(bob, 'Bob one');
    expect([a1.number, a2.number]).toEqual([1, 2]);
    expect(b1.number).toBe(1);
  });

  it('never reuses a number, even after the step that held it is gone', async () => {
    const gone = await addStep(alice, 'Alice gone');
    await asUser(alice, (tx) => tx`delete from plan_items where id = ${gone.id}`);
    const next = await addStep(alice, 'Alice next');
    expect(next.number).toBeGreaterThan(gone.number);
  });
});

describe('the tree', () => {
  it('nests a step under a parent of the same account', async () => {
    const feature = await addStep(alice, 'Feature');
    const step = await addStep(alice, 'Step', { parentId: feature.id });
    const [row] = await asUser(alice, (tx) =>
      tx<{ parent_id: string }[]>`select parent_id from plan_items where id = ${step.id}`,
    );
    expect(row.parent_id).toBe(feature.id);
  });

  it("refuses another account's step as a parent, as if it did not exist", async () => {
    const feature = await addStep(alice, 'Alice feature');
    await expect(addStep(bob, 'Bob sneaks in', { parentId: feature.id })).rejects.toThrow(
      /does not exist/,
    );
  });

  it('refuses to move a step under one of its own sub-steps', async () => {
    const top = await addStep(alice, 'Top');
    const mid = await addStep(alice, 'Mid', { parentId: top.id });
    const leaf = await addStep(alice, 'Leaf', { parentId: mid.id });
    await expect(
      asUser(alice, (tx) => tx`update plan_items set parent_id = ${leaf.id} where id = ${top.id}`),
    ).rejects.toThrow(/its own sub-steps/);
    // Its own parent is the degenerate case of the same thing.
    await expect(
      asUser(alice, (tx) => tx`update plan_items set parent_id = ${top.id} where id = ${top.id}`),
    ).rejects.toThrow();
  });

  it('takes the steps with the feature when the feature is deleted', async () => {
    const feature = await addStep(alice, 'Doomed feature');
    const step = await addStep(alice, 'Doomed step', { parentId: feature.id });
    const sub = await addStep(alice, 'Doomed sub-step', { parentId: step.id });
    await asUser(alice, (tx) => tx`delete from plan_items where id = ${feature.id}`);
    const rows = await asUser(alice, (tx) =>
      tx`select id from plan_items where id in (${step.id}, ${sub.id})`,
    );
    expect(rows).toHaveLength(0);
  });
});

describe('dependencies', () => {
  it('records that one step waits on another of the same account', async () => {
    const a = await addStep(alice, 'First');
    const b = await addStep(alice, 'Second');
    const [row] = await asUser(alice, (tx) =>
      tx<{ id: string }[]>`
        insert into plan_dependencies (user_id, item_id, depends_on_id)
        values (${alice}, ${b.id}, ${a.id}) returning id`,
    );
    expect(row.id).toBeTruthy();
  });

  it('refuses a step waiting on itself', async () => {
    const a = await addStep(alice, 'Self');
    await expect(
      asUser(alice, (tx) =>
        tx`insert into plan_dependencies (user_id, item_id, depends_on_id) values (${alice}, ${a.id}, ${a.id})`,
      ),
    ).rejects.toThrow();
  });

  it('refuses two steps waiting on each other, however long the way round', async () => {
    const a = await addStep(alice, 'Ring a');
    const b = await addStep(alice, 'Ring b');
    const c = await addStep(alice, 'Ring c');
    await asUser(alice, (tx) =>
      tx`insert into plan_dependencies (user_id, item_id, depends_on_id)
         values (${alice}, ${b.id}, ${a.id}), (${alice}, ${c.id}, ${b.id})`,
    );
    await expect(
      asUser(alice, (tx) =>
        tx`insert into plan_dependencies (user_id, item_id, depends_on_id) values (${alice}, ${a.id}, ${c.id})`,
      ),
    ).rejects.toThrow(/wait on each other/);
  });

  it("refuses a dependency on another account's step", async () => {
    const theirs = await addStep(alice, 'Alice step');
    const mine = await addStep(bob, 'Bob step');
    await expect(
      asUser(bob, (tx) =>
        tx`insert into plan_dependencies (user_id, item_id, depends_on_id) values (${bob}, ${mine.id}, ${theirs.id})`,
      ),
    ).rejects.toThrow(/your own/);
  });

  it('goes with either step when that step is deleted', async () => {
    const a = await addStep(alice, 'Kept');
    const b = await addStep(alice, 'Removed');
    await asUser(alice, (tx) =>
      tx`insert into plan_dependencies (user_id, item_id, depends_on_id) values (${alice}, ${a.id}, ${b.id})`,
    );
    await asUser(alice, (tx) => tx`delete from plan_items where id = ${b.id}`);
    const rows = await asUser(alice, (tx) =>
      tx`select id from plan_dependencies where item_id = ${a.id}`,
    );
    expect(rows).toHaveLength(0);
  });
});

describe('when things happened', () => {
  async function stamps(id: string) {
    const [row] = await asUser(alice, (tx) =>
      tx<{ started_at: Date | null; blocked_at: Date | null; completed_at: Date | null }[]>`
        select started_at, blocked_at, completed_at from plan_items where id = ${id}`,
    );
    return row;
  }

  it('stamps the start when a step is started and keeps it', async () => {
    const step = await addStep(alice, 'Timed');
    expect((await stamps(step.id)).started_at).toBeNull();

    await asUser(alice, (tx) => tx`update plan_items set status = 'in_progress' where id = ${step.id}`);
    const started = (await stamps(step.id)).started_at;
    expect(started).not.toBeNull();

    await asUser(alice, (tx) => tx`update plan_items set status = 'blocked' where id = ${step.id}`);
    await asUser(alice, (tx) => tx`update plan_items set status = 'in_progress' where id = ${step.id}`);
    expect((await stamps(step.id)).started_at).toEqual(started);
  });

  it('stamps completion on done or dropped, and takes it back on reopening', async () => {
    const step = await addStep(alice, 'Finished');
    await asUser(alice, (tx) => tx`update plan_items set status = 'done' where id = ${step.id}`);
    expect((await stamps(step.id)).completed_at).not.toBeNull();

    await asUser(alice, (tx) => tx`update plan_items set status = 'not_started' where id = ${step.id}`);
    expect((await stamps(step.id)).completed_at).toBeNull();

    await asUser(alice, (tx) => tx`update plan_items set status = 'dropped' where id = ${step.id}`);
    expect((await stamps(step.id)).completed_at).not.toBeNull();
  });

  it('stamps a step inserted already done', async () => {
    const step = await addStep(alice, 'Born done', { status: 'done' });
    expect((await stamps(step.id)).completed_at).not.toBeNull();
  });

  it('stamps a block and takes it back when the step moves on', async () => {
    const step = await addStep(alice, 'Stuck');
    expect((await stamps(step.id)).blocked_at).toBeNull();

    await asUser(alice, (tx) => tx`update plan_items set status = 'blocked' where id = ${step.id}`);
    const blocked = (await stamps(step.id)).blocked_at;
    expect(blocked).not.toBeNull();

    // A session blocking a step that is already blocked rewrites the ask. The
    // instant it stopped is the first one, not the latest visit.
    await asUser(
      alice,
      (tx) =>
        tx`update plan_items set status = 'blocked', block_ask = 'still stuck' where id = ${step.id}`,
    );
    expect((await stamps(step.id)).blocked_at).toEqual(blocked);

    await asUser(alice, (tx) => tx`update plan_items set status = 'in_progress' where id = ${step.id}`);
    expect((await stamps(step.id)).blocked_at).toBeNull();
  });

  it('stamps a step inserted already blocked', async () => {
    const step = await addStep(alice, 'Born blocked', { status: 'blocked' });
    expect((await stamps(step.id)).blocked_at).not.toBeNull();
  });
});

/**
 * The reading the overnight runner takes to tell a session that is working
 * from one that has stopped. It used to ask whether the feature it fired at
 * had closed, and a feature does not close while any step under it is open --
 * so a session that closed three steps of four looked identical to a session
 * that had died, and the runner sat out a two-hour silence timeout before
 * firing again. Two nights lost about four hours each to it.
 */
describe('the newest close under a step', () => {
  async function closedAt(id: string): Promise<Date | null> {
    const [row] = await asUser(alice, (tx) =>
      tx<{ at: Date | null }[]>`select public.plan_subtree_closed_at(${id}) as at`,
    );
    return row.at;
  }

  it('is null while nothing under it has closed', async () => {
    const feature = await addStep(alice, 'Nothing done yet');
    await addStep(alice, 'Open step', { parentId: feature.id });
    expect(await closedAt(feature.id)).toBeNull();
  });

  it('answers for a feature that can never close itself', async () => {
    // The shape that cost the runner its nights: some steps done, one left
    // `proposed` -- which is the person's to approve and no session may close,
    // so the feature stays open for good.
    const feature = await addStep(alice, 'Half built');
    await addStep(alice, 'Built', { parentId: feature.id, status: 'done' });
    await addStep(alice, 'Waiting on you', { parentId: feature.id, status: 'proposed' });

    const [row] = await asUser(alice, (tx) =>
      tx<{ completed_at: Date | null }[]>`
        select completed_at from plan_items where id = ${feature.id}`,
    );
    // The old reading: the feature itself has not closed and never will.
    expect(row.completed_at).toBeNull();
    // The new one: a step under it closed, so the session was working.
    expect(await closedAt(feature.id)).not.toBeNull();
  });

  it('reaches a step of a step, not just the children', async () => {
    const feature = await addStep(alice, 'Deep');
    const middle = await addStep(alice, 'Middle', { parentId: feature.id });
    await addStep(alice, 'Leaf', { parentId: middle.id, status: 'done' });
    expect(await closedAt(feature.id)).not.toBeNull();
  });

  it('takes the newest close when several have closed', async () => {
    const feature = await addStep(alice, 'Several');
    const first = await addStep(alice, 'First', { parentId: feature.id, status: 'done' });
    const second = await addStep(alice, 'Second', { parentId: feature.id });
    await asUser(alice, (tx) => tx`update plan_items set status = 'done' where id = ${second.id}`);

    const [earlier] = await asUser(alice, (tx) =>
      tx<{ at: Date }[]>`select completed_at as at from plan_items where id = ${first.id}`,
    );
    const newest = await closedAt(feature.id);
    expect(newest).not.toBeNull();
    expect((newest as Date).getTime()).toBeGreaterThanOrEqual(earlier.at.getTime());
  });

  it("shows one account nothing of another account's plan", async () => {
    // `security invoker`, so the policy on plan_items still applies and a step
    // belonging to someone else reads as an empty subtree rather than a date.
    const hers = await addStep(bob, 'Bob feature');
    await addStep(bob, 'Bob step', { parentId: hers.id, status: 'done' });
    expect(await closedAt(hers.id)).toBeNull();
  });
});
