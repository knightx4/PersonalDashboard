import { describe, expect, it } from 'vitest';
import { JOBS_CHANGE_KINDS } from '@/lib/ask/jobs-changes';
import { fakeSchemaDb, type FakeTables } from '../../tests/stubs/fake-schema-db';
import { JOBS_WRITES, runJobsWrite, type JobsWriteEnv } from './jobs-writes';

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

const env = (tables: FakeTables): JobsWriteEnv => ({ userId: ME, jobs: fakeSchemaDb(tables)('job_search') });

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
