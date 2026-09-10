/**
 * Isolation for the todo schema, and the check that RLS on its own does not do.
 *
 * The link tests are the reason this file exists in the same commit as the
 * migration. `todo.task_links` carries foreign keys into three other schemas,
 * and **a foreign key is not an ownership check**: Postgres performs
 * referential integrity checks bypassing row level security, so the key to
 * job_search.roles is satisfied by any role in the table -- including another
 * account's. The policy on task_links only asks who owns the task.
 *
 * A cross-user isolation suite that covered only the tables with their own
 * user_id column would pass with that hole wide open. It is the reason the
 * first draft of the spec said the trigger was unnecessary.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asUser, closeDb, createRole, createUser, truncateAll } from './helpers/db-todo';

let userA = '';
let userB = '';
let taskA = '';
let roleA = '';
let roleB = '';

beforeAll(async () => {
  await truncateAll();
  userA = await createUser('todo-a@example.com');
  userB = await createUser('todo-b@example.com');

  const [task] = await admin<{ id: string }[]>`
    insert into tasks (user_id, title) values (${userA}, 'Renew the passport') returning id`;
  taskA = task.id;

  roleA = await createRole(userA, 'Acme');
  roleB = await createRole(userB, 'Umbrella');
});

afterAll(closeDb);

describe('todo.tasks', () => {
  it('shows a user only their own', async () => {
    await admin`insert into tasks (user_id, title) values (${userB}, 'Call the landlord')`;

    const mine = await asUser(userA, (tx) => tx<{ title: string }[]>`select title from tasks`);
    expect(mine.map((r) => r.title)).toEqual(['Renew the passport']);

    const theirs = await asUser(userB, (tx) => tx<{ title: string }[]>`select title from tasks`);
    expect(theirs.map((r) => r.title)).toEqual(['Call the landlord']);
  });

  it('refuses a task written on somebody else', async () => {
    await expect(
      asUser(userB, (tx) => tx`insert into tasks (user_id, title) values (${userA}, 'Not yours')`),
    ).rejects.toThrow(/row-level security/);
  });

  it('does not let a user edit or delete another user\'s task', async () => {
    await asUser(userB, async (tx) => {
      const updated = await tx`update tasks set title = 'Hijacked' where id = ${taskA}`;
      const deleted = await tx`delete from tasks where id = ${taskA}`;
      expect(updated.count).toBe(0);
      expect(deleted.count).toBe(0);
    });

    const [row] = await admin<{ title: string }[]>`select title from tasks where id = ${taskA}`;
    expect(row.title).toBe('Renew the passport');
  });
});

describe('todo.tasks status', () => {
  it('stamps completed_at rather than rejecting an update that omits it', async () => {
    // The check constraint says a done row must carry a timestamp. Without the
    // trigger this update is a constraint violation, and every caller would
    // have to remember -- one eventually would not.
    await asUser(userA, async (tx) => {
      await tx`update tasks set status = 'done' where id = ${taskA}`;
    });

    const [row] = await admin<{ status: string; completed_at: string | null }[]>`
      select status, completed_at from tasks where id = ${taskA}`;
    expect(row.status).toBe('done');
    expect(row.completed_at).not.toBeNull();
  });

  it('clears the stamp when a task is reopened', async () => {
    await asUser(userA, async (tx) => {
      await tx`update tasks set status = 'open' where id = ${taskA}`;
    });

    const [row] = await admin<{ completed_at: string | null }[]>`
      select completed_at from tasks where id = ${taskA}`;
    expect(row.completed_at).toBeNull();
  });

  it('refuses a task due both on a date and at an instant', async () => {
    await expect(
      admin`insert into tasks (user_id, title, due_on, due_at)
            values (${userA}, 'Ambiguous', current_date, now())`,
    ).rejects.toThrow(/tasks_one_due_ck/);
  });

  it('refuses a blank title, whitespace included', async () => {
    await expect(
      admin`insert into tasks (user_id, title) values (${userA}, '   ')`,
    ).rejects.toThrow(/tasks_title_ck/);
  });
});

describe('todo.task_links', () => {
  it('links a task to a role its owner owns', async () => {
    await asUser(userA, async (tx) => {
      await tx`insert into task_links (task_id, relation, role_id)
               values (${taskA}, 'about', ${roleA})`;
    });

    const [row] = await admin<{ n: string }[]>`
      select count(*) as n from task_links where task_id = ${taskA}`;
    expect(Number(row.n)).toBe(1);
  });

  it('REFUSES a link to another account\'s role', async () => {
    // The whole reason this file lands with the migration. The foreign key is
    // satisfied -- roleB is a real role -- and RLS is satisfied, because userA
    // owns the task. Only the trigger says no.
    await expect(
      asUser(
        userA,
        (tx) => tx`insert into task_links (task_id, relation, role_id)
                   values (${taskA}, 'source', ${roleB})`,
      ),
    ).rejects.toThrow(/must point at something/);
  });

  it('refuses a link on a task belonging to somebody else', async () => {
    await expect(
      asUser(
        userB,
        (tx) => tx`insert into task_links (task_id, relation, role_id)
                   values (${taskA}, 'source', ${roleB})`,
      ),
    ).rejects.toThrow(/row-level security|must point at something/);
  });

  it('allows only one "about" per task, and any number of sources', async () => {
    const [second] = await admin<{ id: string }[]>`
      insert into tasks (user_id, title) values (${userA}, 'Two anchors') returning id`;

    await admin`insert into task_links (task_id, relation, role_id)
                values (${second.id}, 'about', ${roleA})`;

    await expect(
      admin`insert into task_links (task_id, relation, company_id)
            select ${second.id}, 'about', company_id from job_search.roles where id = ${roleA}`,
    ).rejects.toThrow(/task_links_about_key/);

    await admin`insert into task_links (task_id, relation, company_id)
                select ${second.id}, 'source', company_id from job_search.roles where id = ${roleA}`;

    const [row] = await admin<{ n: string }[]>`
      select count(*) as n from task_links where task_id = ${second.id}`;
    expect(Number(row.n)).toBe(2);
  });

  it('refuses a link pointing at nothing, and at more than one thing', async () => {
    await expect(
      admin`insert into task_links (task_id, relation) values (${taskA}, 'source')`,
    ).rejects.toThrow(/task_links_exactly_one_ck/);

    await expect(
      admin`insert into task_links (task_id, relation, role_id, company_id)
            select ${taskA}, 'source', ${roleA}, company_id
            from job_search.roles where id = ${roleA}`,
    ).rejects.toThrow(/task_links_exactly_one_ck/);
  });

  it('links a task to a saved item and a subject its owner owns', async () => {
    // The targets migrations-todo/0004 added, one from public and one from
    // learn. They matter here for the same reason the job_search ones do: the
    // foreign key is satisfied by any row in the table, whoever owns it.
    const [saved] = await admin<{ id: string }[]>`
      insert into public.saved_items (user_id, url, title)
      values (${userA}, 'https://example.com/desk', 'Standing desk') returning id`;
    const [subject] = await admin<{ id: string }[]>`
      insert into learn.subjects (user_id, name) values (${userA}, 'Price signals') returning id`;

    const [shop, study] = await admin<{ id: string }[]>`
      insert into tasks (user_id, title)
      values (${userA}, 'Measure the alcove'), (${userA}, 'Read the Hayek essay')
      returning id`;

    await asUser(userA, async (tx) => {
      await tx`insert into task_links (task_id, relation, saved_item_id)
               values (${shop.id}, 'about', ${saved.id})`;
      await tx`insert into task_links (task_id, relation, subject_id)
               values (${study.id}, 'about', ${subject.id})`;
    });

    const [row] = await admin<{ n: string }[]>`
      select count(*) as n from task_links where task_id in (${shop.id}, ${study.id})`;
    expect(Number(row.n)).toBe(2);
  });

  it('REFUSES a link to another account\'s subject', async () => {
    const [subject] = await admin<{ id: string }[]>`
      insert into learn.subjects (user_id, name) values (${userB}, 'Not yours') returning id`;

    await expect(
      asUser(
        userA,
        (tx) => tx`insert into task_links (task_id, relation, subject_id)
                   values (${taskA}, 'source', ${subject.id})`,
      ),
    ).rejects.toThrow(/must point at something/);
  });

  it('drops the link when the role goes, and keeps the task', async () => {
    await admin`delete from job_search.roles where id = ${roleA}`;

    const [links] = await admin<{ n: string }[]>`
      select count(*) as n from task_links where task_id = ${taskA}`;
    const [tasks] = await admin<{ n: string }[]>`
      select count(*) as n from tasks where id = ${taskA}`;

    expect(Number(links.n)).toBe(0);
    expect(Number(tasks.n)).toBe(1);
  });
});

describe('todo.events', () => {
  it('shows a user only their own, and refuses one written on somebody else', async () => {
    await admin`insert into events (user_id, title, starts_on, ends_on)
                values (${userA}, 'Dentist', date '2026-03-10', date '2026-03-10')`;
    await admin`insert into events (user_id, title, starts_on, ends_on)
                values (${userB}, 'Their holiday', date '2026-03-10', date '2026-03-14')`;

    const mine = await asUser(userA, (tx) => tx<{ title: string }[]>`select title from events`);
    expect(mine.map((r) => r.title)).toEqual(['Dentist']);

    await expect(
      asUser(
        userB,
        (tx) => tx`insert into events (user_id, title, starts_on, ends_on)
                   values (${userA}, 'Not yours', date '2026-03-11', date '2026-03-11')`,
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('does not let a user edit or delete another user\'s event', async () => {
    const [event] = await admin<{ id: string }[]>`
      insert into events (user_id, title, starts_at, ends_at)
      values (${userA}, 'Standup', timestamptz '2026-03-10 09:00+00', timestamptz '2026-03-10 09:15+00')
      returning id`;

    await asUser(userB, async (tx) => {
      const updated = await tx`update events set title = 'Hijacked' where id = ${event.id}`;
      const deleted = await tx`delete from events where id = ${event.id}`;
      expect(updated.count).toBe(0);
      expect(deleted.count).toBe(0);
    });

    const [row] = await admin<{ title: string }[]>`select title from events where id = ${event.id}`;
    expect(row.title).toBe('Standup');
  });

  it('refuses an event that is both all day and timed, and one that is neither', async () => {
    await expect(
      admin`insert into events (user_id, title, starts_on, ends_on, starts_at, ends_at)
            values (${userA}, 'Both', date '2026-03-10', date '2026-03-10',
                    timestamptz '2026-03-10 09:00+00', timestamptz '2026-03-10 10:00+00')`,
    ).rejects.toThrow(/events_one_span_ck/);

    await expect(
      admin`insert into events (user_id, title) values (${userA}, 'Whenever')`,
    ).rejects.toThrow(/events_one_span_ck/);

    // Half a pair is not a pair: an event that starts and never ends cannot be
    // drawn, so it is not stored either.
    await expect(
      admin`insert into events (user_id, title, starts_at)
            values (${userA}, 'Open ended', timestamptz '2026-03-10 09:00+00')`,
    ).rejects.toThrow(/events_one_span_ck/);
  });

  it('refuses an end before its start, on either pair', async () => {
    await expect(
      admin`insert into events (user_id, title, starts_on, ends_on)
            values (${userA}, 'Backwards', date '2026-03-10', date '2026-03-09')`,
    ).rejects.toThrow(/events_span_order_ck/);

    await expect(
      admin`insert into events (user_id, title, starts_at, ends_at)
            values (${userA}, 'Backwards', timestamptz '2026-03-10 10:00+00',
                    timestamptz '2026-03-10 09:00+00')`,
    ).rejects.toThrow(/events_span_order_ck/);
  });

  it('refuses a blank title, whitespace included', async () => {
    await expect(
      admin`insert into events (user_id, title, starts_on, ends_on)
            values (${userA}, '   ', date '2026-03-10', date '2026-03-10')`,
    ).rejects.toThrow(/events_title_ck/);
  });
});

describe('todo.dismissals', () => {
  it('is one row per user, source and key', async () => {
    await admin`insert into dismissals (user_id, source, source_key)
                values (${userA}, 'return_deadline', 'order-1')`;

    await expect(
      admin`insert into dismissals (user_id, source, source_key)
            values (${userA}, 'return_deadline', 'order-1')`,
    ).rejects.toThrow(/duplicate key/);

    // The same key for a different account is a different dismissal.
    await admin`insert into dismissals (user_id, source, source_key)
                values (${userB}, 'return_deadline', 'order-1')`;
  });

  it('shows a user only their own', async () => {
    const mine = await asUser(userA, (tx) => tx<{ user_id: string }[]>`select user_id from dismissals`);
    expect(mine.map((r) => r.user_id)).toEqual([userA]);
  });
});

describe('everything cascades out with the account', () => {
  it('leaves nothing behind', async () => {
    const doomed = await createUser('todo-gone@example.com');
    const [task] = await admin<{ id: string }[]>`
      insert into tasks (user_id, title) values (${doomed}, 'Ephemeral') returning id`;
    const role = await createRole(doomed, 'Transient');
    await admin`insert into task_links (task_id, relation, role_id) values (${task.id}, 'about', ${role})`;
    await admin`insert into dismissals (user_id, source, source_key)
                values (${doomed}, 'return_deadline', 'order-gone')`;
    await admin`insert into events (user_id, title, starts_on, ends_on)
                values (${doomed}, 'Leaving drinks', date '2026-03-10', date '2026-03-10')`;

    await admin`delete from auth.users where id = ${doomed}`;

    const [tasks] = await admin<{ n: string }[]>`
      select count(*) as n from tasks where user_id = ${doomed}`;
    const [links] = await admin<{ n: string }[]>`
      select count(*) as n from task_links where task_id = ${task.id}`;
    const [dismissals] = await admin<{ n: string }[]>`
      select count(*) as n from dismissals where user_id = ${doomed}`;
    const [events] = await admin<{ n: string }[]>`
      select count(*) as n from events where user_id = ${doomed}`;

    expect([tasks.n, links.n, dismissals.n, events.n].map(Number)).toEqual([0, 0, 0, 0]);
  });
});
