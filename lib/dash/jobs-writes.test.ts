import { describe, expect, it } from 'vitest';
import { JOBS_CHANGE_KINDS } from '@/lib/ask/jobs-changes';
import { fakeSchemaDb, type FakeTables } from '../../tests/stubs/fake-schema-db';
import { JOBS_WRITES, runJobsWrite, undoRoleMerge, type JobsWriteEnv } from './jobs-writes';

/**
 * The Jobs writes an agent makes (plan #1894.6.1): each names one row, read
 * by its id and the person's user id (the connector runs them with no row
 * level security), and reports the values its Undo needs.
 */

const ME = '00000000-0000-4000-8000-0000000000aa';
const SOMEONE = '00000000-0000-4000-8000-0000000000bb';
const ROLE = '11111111-1111-4111-8111-111111111111';
const COMPANY = '22222222-2222-4222-8222-222222222222';
const APP_1 = '33333333-3333-4333-8333-333333333333';
const APP_2 = '44444444-4444-4444-8444-444444444444';
const CONTACT = '55555555-5555-4555-8555-555555555555';
const ROLE_2 = '66666666-6666-4666-8666-666666666666';
const COMPANY_2 = '77777777-7777-4777-8777-777777777777';
const EVENT = '88888888-8888-4888-8888-888888888888';
const ANSWER_1 = '99999999-9999-4999-8999-999999999991';
const ANSWER_2 = '99999999-9999-4999-8999-999999999992';
const QUESTION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LINK = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const env = (tables: FakeTables): JobsWriteEnv => {
  const db = fakeSchemaDb(tables);
  return { userId: ME, jobs: db('job_search'), todo: db('todo'), core: db('core') };
};

const write = (name: string) => JOBS_WRITES.find((entry) => entry.name === name)!;

async function made(name: string, tables: FakeTables, input: Record<string, unknown>) {
  const result = await runJobsWrite(write(name), env(tables), input);
  if ('ok' in result) throw new Error(result.error);
  return result;
}

async function refused(name: string, tables: FakeTables, input: Record<string, unknown>) {
  const result = await runJobsWrite(write(name), env(tables), input);
  if (!('ok' in result)) throw new Error('expected a refusal');
  return result.error;
}

function tables(): FakeTables {
  return {
    'job_search.companies': [{ id: COMPANY, user_id: ME, name: 'Acme', slug: 'acme', domains: [] }],
    'job_search.roles': [
      {
        id: ROLE,
        user_id: ME,
        company_id: COMPANY,
        title: 'Role from email',
        location: null,
        work_mode: null,
        posting_status: 'unknown',
        comp_min_cents: null,
        comp_max_cents: null,
        comp_source: null,
        jd_text: null,
      },
    ],
    'job_search.applications': [
      { id: APP_1, user_id: ME, role_id: ROLE, attempt: 1, excitement: null, source: 'portal', referral_contact_id: null },
      { id: APP_2, user_id: ME, role_id: ROLE, attempt: 2, excitement: 2, source: 'portal', referral_contact_id: null },
    ],
    'job_search.contacts': [{ id: CONTACT, user_id: ME, name: 'Sam' }],
  };
}

describe('the Jobs writes', () => {
  it('are the kinds Ask keeps them under, in order', () => {
    expect(JOBS_WRITES.map((entry) => entry.name)).toEqual([...JOBS_CHANGE_KINDS]);
  });

  it('renames a role and sets its pay, keeping the row as it was', async () => {
    const change = await made('change_role', tables(), {
      role_ref: ROLE,
      title: 'Data Engineer',
      work_mode: 'remote',
      pay_min: 150000,
      pay_max: 180000,
    });
    expect(change.op).toBe('update');
    expect(change.subjectRef).toBe(`job_search.roles:${ROLE}`);
    expect(change.before).toMatchObject({ title: 'Role from email', comp_min_cents: null });
    expect(change.after).toMatchObject({ title: 'Data Engineer', work_mode: 'remote', comp_min_cents: 15_000_000, comp_max_cents: 18_000_000 });
    expect(change.summary).toBe('Dash changed the title, the work mode and the pay on the role Role from email at Acme.');
    expect(change.row).toMatchObject({ table: 'job_search.roles', ref: ROLE, title: 'Data Engineer at Acme', href: `/jobs/roles/${ROLE}` });
  });

  it('moves a role to a company not on file yet, making it', async () => {
    const t = tables();
    const change = await made('change_role', t, { application_ref: APP_1, company: 'Globex' });
    const globex = t['job_search.companies'].find((c) => c.name === 'Globex');
    expect(globex).toMatchObject({ user_id: ME, slug: 'globex' });
    expect(change.after).toMatchObject({ company_id: globex!.id });
    expect(change.before).toMatchObject({ company_id: COMPANY });
    expect(change.row.title).toBe('Role from email at Globex');
  });

  it('reads the pay band from a pasted description, as the page does', async () => {
    const change = await made('change_role', tables(), {
      role_ref: ROLE,
      description: 'We build data tools.\nThe salary range for this role is $150,000 - $180,000 per year.',
    });
    expect(change.after).toMatchObject({ jd_source: 'manual', comp_source: 'posted' });
    expect(change.after.jd_hash).toEqual(expect.any(String));
  });

  it('refuses a band whose top is under its bottom, an empty title and a call with nothing in it', async () => {
    expect(await refused('change_role', tables(), { role_ref: ROLE, pay_min: 200000, pay_max: 100000 })).toMatch(/below the bottom/);
    expect(await refused('change_role', tables(), { role_ref: ROLE, title: ' ' })).toMatch(/needs a title/);
    expect(await refused('change_role', tables(), { role_ref: ROLE })).toMatch(/Nothing to change/);
    expect(await refused('change_role', tables(), { role_ref: ROLE, work_mode: 'moon' })).toMatch(/onsite, hybrid, remote/);
  });

  it('refuses a role that is not theirs', async () => {
    const t = tables();
    t['job_search.roles'][0].user_id = SOMEONE;
    expect(await refused('change_role', t, { role_ref: ROLE, title: 'Mine now' })).toMatch(/no role of theirs/);
    expect(t['job_search.roles'][0].title).toBe('Role from email');
  });

  it("sets excitement on a role's latest application", async () => {
    const change = await made('change_application', tables(), { role_ref: ROLE, excitement: 5 });
    expect(change.subjectRef).toBe(`job_search.applications:${APP_2}`);
    expect(change.before).toMatchObject({ excitement: 2 });
    expect(change.after).toMatchObject({ excitement: 5 });
    expect(change.summary).toBe('Dash set how excited they are to 5 of 5 for the role Role from email at Acme.');
  });

  it('sets a referral with who referred them, and any other channel clears it', async () => {
    const t = tables();
    const referral = await made('change_application', t, { application_ref: APP_1, channel: 'referral', referral_contact_ref: CONTACT });
    expect(referral.after).toMatchObject({ source: 'referral', referral_contact_id: CONTACT });
    const board = await made('change_application', t, { application_ref: APP_1, channel: 'job_board' });
    expect(board.after).toMatchObject({ source: 'job_board', referral_contact_id: null });
  });

  it('clears excitement with 0 and refuses one out of range', async () => {
    const change = await made('change_application', tables(), { application_ref: APP_2, excitement: 0 });
    expect(change.after).toMatchObject({ excitement: null });
    expect(await refused('change_application', tables(), { application_ref: APP_2, excitement: 9 })).toMatch(/1 to 5/);
  });

  it("refuses a referral contact that is not theirs", async () => {
    const t = tables();
    t['job_search.contacts'][0].user_id = SOMEONE;
    expect(
      await refused('change_application', t, { application_ref: APP_1, channel: 'referral', referral_contact_ref: CONTACT }),
    ).toMatch(/no contact of theirs/);
  });
});

describe('change_company (plan #1894.6.2)', () => {
  it('renames a company, moving its slug with it, and tidies its domains', async () => {
    const change = await made('change_company', tables(), {
      company: 'acme',
      name: 'Acme Robotics',
      domains: 'https://www.acme.com/jobs, not a domain, acme.io',
      priority: 'target',
    });
    expect(change.subjectRef).toBe(`job_search.companies:${COMPANY}`);
    expect(change.before).toMatchObject({ name: 'Acme', slug: 'acme' });
    expect(change.after).toMatchObject({ name: 'Acme Robotics', slug: 'acme-robotics', domains: ['acme.com', 'acme.io'], priority: 'target' });
    expect(change.summary).toBe('Dash changed the name, to Acme Robotics, the priority, to target and the domains on the company Acme.');
    expect(change.row.href).toBe('/jobs/companies/acme-robotics');
    expect(change.undo).toBeNull();
  });

  it('refuses a name another of their companies has, and a company that is not theirs', async () => {
    const t = tables();
    t['job_search.companies'].push({ id: COMPANY_2, user_id: ME, name: 'Globex', slug: 'globex', domains: [] });
    expect(await refused('change_company', t, { company_ref: COMPANY, name: 'Globex' })).toMatch(/already have a company called Globex/);
    t['job_search.companies'][0].user_id = SOMEONE;
    expect(await refused('change_company', t, { company_ref: COMPANY, industry: 'Robots' })).toMatch(/no company of theirs/);
  });
});

describe('merge_roles (plan #1894.6.2)', () => {
  function dupes(): FakeTables {
    const t = tables();
    t['job_search.roles'].push({ id: ROLE_2, user_id: ME, company_id: COMPANY, title: 'Data Engineer' });
    t['job_search.applications'] = [
      { id: APP_1, user_id: ME, role_id: ROLE, attempt: 1, status: 'submitted', status_manual_override: null, created_at: '2026-10-01T00:00:00Z' },
      { id: APP_2, user_id: ME, role_id: ROLE_2, attempt: 1, status: 'in_process', status_manual_override: null, created_at: '2026-10-02T00:00:00Z' },
    ];
    t['job_search.application_events'] = [{ id: EVENT, user_id: ME, application_id: APP_1 }];
    t['job_search.application_answers'] = [
      { id: ANSWER_1, user_id: ME, application_id: APP_1, question_id: QUESTION },
      { id: ANSWER_2, user_id: ME, application_id: APP_2, question_id: QUESTION },
    ];
    t['todo.task_links'] = [{ id: LINK, role_id: ROLE_2, application_id: null }];
    return t;
  }

  it('folds a duplicate into the role kept, keeping the application furthest along, and keeps every row for the Undo', async () => {
    const t = dupes();
    const change = await made('merge_roles', t, { keep_role_ref: ROLE, merge_role_refs: [ROLE_2] });

    expect(t['job_search.roles'].map((r) => r.id)).toEqual([ROLE]);
    expect(t['job_search.applications']).toEqual([expect.objectContaining({ id: APP_2, role_id: ROLE, attempt: 1 })]);
    expect(t['job_search.application_events'][0]).toMatchObject({ application_id: APP_2 });
    // The answer to the same question on the application kept stays; its twin is taken out.
    expect(t['job_search.application_answers'].map((a) => a.id)).toEqual([ANSWER_2]);
    expect(t['todo.task_links'][0]).toMatchObject({ role_id: ROLE });
    expect(change.subjectRef).toBe(`job_search.roles:${ROLE}`);
    expect(change.summary).toBe('Dash merged "Data Engineer at Acme" into the role Role from email at Acme.');
    expect(change.undo).toMatchObject({
      roles_removed: [expect.objectContaining({ id: ROLE_2 })],
      applications_removed: [expect.objectContaining({ id: APP_1 })],
      removed: [{ table: 'job_search.application_answers', values: expect.objectContaining({ id: ANSWER_1 }) }],
    });

    const undone = await undoRoleMerge({ userId: ME, db: async (schema) => fakeSchemaDb(t)(schema) }, change.undo);
    expect(undone).toMatchObject({ ok: true });
    expect(t['job_search.roles'].map((r) => r.id).sort()).toEqual([ROLE, ROLE_2].sort());
    expect(t['job_search.applications'].find((a) => a.id === APP_2)).toMatchObject({ role_id: ROLE_2, attempt: 1 });
    expect(t['job_search.applications'].find((a) => a.id === APP_1)).toMatchObject({ role_id: ROLE });
    expect(t['job_search.application_events'][0]).toMatchObject({ application_id: APP_1 });
    expect(t['job_search.application_answers'].map((a) => a.id).sort()).toEqual([ANSWER_1, ANSWER_2].sort());
    expect(t['todo.task_links'][0]).toMatchObject({ role_id: ROLE_2 });
  });

  it('refuses roles at another company, a role that is not theirs, and a duplicate with a thread', async () => {
    const other = dupes();
    other['job_search.roles'][1].company_id = COMPANY_2;
    expect(await refused('merge_roles', other, { keep_role_ref: ROLE, merge_role_refs: [ROLE_2] })).toMatch(/same company/);

    const theirs = dupes();
    theirs['job_search.roles'][1].user_id = SOMEONE;
    expect(await refused('merge_roles', theirs, { keep_role_ref: ROLE, merge_role_refs: [ROLE_2] })).toMatch(/no role of theirs/);

    const threaded = dupes();
    threaded['core.conversation_turns'] = [{ id: EVENT, user_id: ME, ref: `job_search.roles:${ROLE_2}`, author: 'me', body: 'Hi' }];
    expect(await refused('merge_roles', threaded, { keep_role_ref: ROLE, merge_role_refs: [ROLE_2] })).toMatch(/comments in its thread/);
    expect(threaded['job_search.roles']).toHaveLength(2);

    expect(await refused('merge_roles', dupes(), { keep_role_ref: ROLE, merge_role_refs: [ROLE] })).toMatch(/Pick a different role/);
  });
});
