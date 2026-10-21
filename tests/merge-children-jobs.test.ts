/**
 * What a role merge moves, against what the database says hangs off a role.
 *
 * Dash's merge_roles reads rows by two lists in lib/dash/jobs-writes.ts
 * before and after job_search.merge_roles moves them, so it can record each
 * move for its Undo, and the in-memory database moves rows by them. A list
 * like that is right when it is written and wrong after the next table with
 * a foreign key to applications or roles: the company page's merge listed
 * eight of fourteen, and merging deleted the rest. This reads the foreign keys from the migrated database
 * and fails when a list misses one.
 *
 * job_search.merge_roles reads the keys itself; the second half checks it
 * moves a row from every table, twins included, and keeps the application
 * the caller names.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { admin, asUser, closeDb, createUser, truncateAll } from './helpers/db-jobs';
import { APPLICATION_CHILDREN, ROLE_CHILDREN } from '@/lib/dash/jobs-writes';

async function childrenOf(parent: string): Promise<string[]> {
  const rows = await admin<{ child: string }[]>`
    select n.nspname || '.' || t.relname || '.' || a.attname as child
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.confrelid = ${parent}::regclass and c.contype = 'f'
  `;
  return rows.map((row) => row.child).sort();
}

describe('Dash merge_roles lists', () => {
  it('moves every table that points at an application', async () => {
    const listed = APPLICATION_CHILDREN.map((child) => `${child.table}.${child.column}`).sort();
    expect(listed).toEqual(await childrenOf('job_search.applications'));
  });

  it('moves every table that points at a role, but for the ones it handles apart', async () => {
    // Applications are folded on their own; old thread notes refuse the merge.
    const apart = ['job_search.applications.role_id', 'job_search.notes.role_id'];
    const listed = [...ROLE_CHILDREN.map((child) => `${child.table}.${child.column}`), ...apart].sort();
    expect(listed).toEqual(await childrenOf('job_search.roles'));
  });
});

describe('job_search.merge_roles', () => {
  let me: string;
  let company: string;

  async function role(title: string): Promise<string> {
    const [row] = await admin<{ id: string }[]>`
      insert into roles (user_id, company_id, title) values (${me}, ${company}, ${title}) returning id
    `;
    return row.id;
  }

  async function application(roleId: string): Promise<string> {
    const [row] = await admin<{ id: string }[]>`
      insert into applications (user_id, role_id) values (${me}, ${roleId}) returning id
    `;
    return row.id;
  }

  beforeEach(async () => {
    await truncateAll();
    me = await createUser('merge-roles@example.com');
    const [row] = await admin<{ id: string }[]>`
      insert into companies (user_id, name, slug) values (${me}, 'Heron Data', 'heron-data') returning id
    `;
    company = row.id;
  });

  afterAll(async () => {
    await truncateAll();
    await closeDb();
  });

  it('keeps the named application and moves what hung off the other', async () => {
    const keep = await role('Strategic Finance Lead');
    const dupe = await role('Role from email');
    const kept = await application(keep);
    const gone = await application(dupe);
    await admin`insert into reminders (user_id, application_id, body, due_at) values (${me}, ${gone}, 'Prep', now())`;
    await admin`insert into interview_groups (user_id, application_id) values (${me}, ${gone})`;
    await admin`insert into notes (user_id, application_id, body) values (${me}, ${gone}, 'From the call.')`;

    await asUser(me, (tx) => tx`select merge_roles(${keep}, ${[dupe]}::uuid[], ${kept})`);

    expect(await admin`select id from roles where company_id = ${company}`).toEqual([{ id: keep }]);
    expect(await admin`select id, role_id, attempt from applications where user_id = ${me}`).toEqual([
      { id: kept, role_id: keep, attempt: 1 },
    ]);
    expect(await admin`select 1 from reminders where application_id = ${kept}`).toHaveLength(1);
    expect(await admin`select 1 from interview_groups where application_id = ${kept}`).toHaveLength(1);
    expect(await admin`select 1 from notes where application_id = ${kept}`).toHaveLength(1);
  });

  it('takes out a row whose twin the kept application already has', async () => {
    const keep = await role('Analyst');
    const dupe = await role('Analyst');
    const kept = await application(keep);
    const gone = await application(dupe);
    await admin`insert into quiet_dismissals (user_id, application_id) values (${me}, ${kept})`;
    await admin`insert into quiet_dismissals (user_id, application_id) values (${me}, ${gone})`;

    await asUser(me, (tx) => tx`select merge_roles(${keep}, ${[dupe]}::uuid[], ${kept})`);

    expect(await admin`select 1 from quiet_dismissals where user_id = ${me}`).toHaveLength(1);
  });

  it('refuses roles at another company, and an application from elsewhere', async () => {
    const keep = await role('Analyst');
    const [other] = await admin<{ id: string }[]>`
      insert into companies (user_id, name, slug) values (${me}, 'Ramp', 'ramp') returning id
    `;
    const [away] = await admin<{ id: string }[]>`
      insert into roles (user_id, company_id, title) values (${me}, ${other.id}, 'Analyst') returning id
    `;
    await expect(
      asUser(me, (tx) => tx`select merge_roles(${keep}, ${[away.id]}::uuid[], null)`),
    ).rejects.toThrow(/same company/);

    const dupe = await role('Analyst');
    await application(dupe);
    const elsewhere = await application(away.id);
    await expect(
      asUser(me, (tx) => tx`select merge_roles(${keep}, ${[dupe]}::uuid[], ${elsewhere})`),
    ).rejects.toThrow(/application to keep/);
  });
});
