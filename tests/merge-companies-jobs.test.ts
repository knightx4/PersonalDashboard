/**
 * job_search.merge_companies folds one company into another.
 *
 * It finds the tables to move from the foreign keys rather than from a list,
 * so these tests check the outcome a person would see: every row that pointed
 * at the merged company points at the kept one, a contact held at both is one
 * contact, the kept row's gaps are filled, and another person's company
 * cannot be reached.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { admin, asUser, closeDb, createUser, truncateAll } from './helpers/db-jobs';

let me: string;
let someone: string;

async function company(userId: string, name: string, extra: Record<string, unknown> = {}): Promise<string> {
  const [row] = await admin<{ id: string }[]>`
    insert into companies ${admin({ user_id: userId, name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), ...extra })}
    returning id
  `;
  return row.id;
}

beforeEach(async () => {
  await truncateAll();
  me = await createUser('merge-me@example.com');
  someone = await createUser('merge-someone@example.com');
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

describe('merge_companies', () => {
  it('moves roles, notes and contacts, fills gaps and deletes the merged row', async () => {
    const keep = await company(me, 'Heron Data', { website: 'https://www.herondata.io', domains: ['herondata.io'] });
    const gone = await company(me, 'Heron', {
      domains: ['herondata.io', 'jobs.ashbyhq.com'],
      industry: 'Fintech',
      ats_type: 'ashby',
      ats_board_token: 'herondata',
      research: 'Series A.',
    });
    await admin`insert into roles (user_id, company_id, title) values (${me}, ${gone}, 'Role from email')`;
    await admin`insert into notes (user_id, company_id, body) values (${me}, ${gone}, 'Met them at a dinner.')`;
    await admin`insert into contacts (user_id, company_id, full_name) values (${me}, ${gone}, 'Ana Ruiz')`;

    const result = await asUser(me, (tx) => tx<{ merge_companies: { kept_slug: string } }[]>`
      select merge_companies(${keep}, ${gone})
    `);
    expect(result[0].merge_companies.kept_slug).toBe('heron-data');

    const [kept] = await admin`select * from companies where id = ${keep}`;
    expect(kept.domains).toEqual(['herondata.io']);
    expect(kept).toMatchObject({ industry: 'Fintech', ats_type: 'ashby', ats_board_token: 'herondata', research: 'Series A.' });
    expect(await admin`select 1 from companies where id = ${gone}`).toHaveLength(0);
    expect(await admin`select 1 from roles where company_id = ${keep}`).toHaveLength(1);
    expect(await admin`select 1 from notes where company_id = ${keep}`).toHaveLength(1);
    expect(await admin`select 1 from contacts where company_id = ${keep}`).toHaveLength(1);
  });

  it('folds a contact held at both into one, carrying what pointed at it', async () => {
    const keep = await company(me, 'Scale AI');
    const gone = await company(me, 'Scale');
    const [kept] = await admin<{ id: string }[]>`
      insert into contacts (user_id, company_id, full_name) values (${me}, ${keep}, 'Sam Lee') returning id
    `;
    const [twin] = await admin<{ id: string }[]>`
      insert into contacts (user_id, company_id, full_name, email) values (${me}, ${gone}, 'sam lee', 'sam@scale.com') returning id
    `;
    await admin`insert into notes (user_id, contact_id, body) values (${me}, ${twin.id}, 'Prefers mornings.')`;

    await asUser(me, (tx) => tx`select merge_companies(${keep}, ${gone})`);

    const contacts = await admin`select id, email from contacts where user_id = ${me}`;
    expect(contacts).toEqual([{ id: kept.id, email: 'sam@scale.com' }]);
    expect(await admin`select 1 from notes where contact_id = ${kept.id}`).toHaveLength(1);
  });

  it('cannot reach another person’s company', async () => {
    const keep = await company(me, 'Ramp');
    const theirs = await company(someone, 'Ramp');
    await expect(asUser(me, (tx) => tx`select merge_companies(${keep}, ${theirs})`)).rejects.toThrow(
      /no longer exists/,
    );
    expect(await admin`select 1 from companies where id = ${theirs}`).toHaveLength(1);
  });

  it('refuses to merge a company into itself', async () => {
    const keep = await company(me, 'Ramp');
    await expect(asUser(me, (tx) => tx`select merge_companies(${keep}, ${keep})`)).rejects.toThrow(
      /different company/,
    );
  });
});
