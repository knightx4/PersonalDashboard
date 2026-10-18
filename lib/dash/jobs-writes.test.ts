import { describe, expect, it } from 'vitest';
import { JOBS_CHANGE_KINDS } from '@/lib/ask/jobs-changes';
import { fakeSchemaDb, type FakeTables } from '../../tests/stubs/fake-schema-db';
import { JOBS_WRITES, runJobsWrite, undoContactRows, undoJobsRows, undoRoleEmail, undoRoleFromEmail, undoRoleMerge, type JobsWriteEnv } from './jobs-writes';

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
const EMAIL = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

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

  it('records where the facts it sets came from (plan #2343.2)', async () => {
    const t = tables();
    await made('change_role', t, { role_ref: ROLE, location: 'London', pay_min: 150000, pay_max: 180000, pay_source: 'recruiter' });
    const origin = (field: string) => (t['job_search.fact_origins'] ?? []).find((row) => row.role_id === ROLE && row.field === field);
    expect(origin('location')).toMatchObject({ user_id: ME, origin: 'dash', certainty: 'guess' });
    expect(origin('comp')).toMatchObject({ origin: 'dash', certainty: 'secondhand' });

    t['job_search.inbox_messages'] = [{ id: EMAIL, user_id: ME, subject: 'Hello' }];
    await made('change_role', t, { role_ref: ROLE, work_mode: 'hybrid', fact_source: 'email', email_ref: EMAIL });
    expect(origin('work_mode')).toMatchObject({ origin: 'dash', certainty: 'secondhand', message_id: EMAIL });

    await made('change_role', t, { role_ref: ROLE, seniority: 'Staff', fact_source: 'person' });
    expect(origin('seniority')).toMatchObject({ origin: 'you', certainty: 'firsthand' });

    await made('change_role', t, { role_ref: ROLE, location: '' });
    expect(origin('location')).toBeUndefined();
  });

  it('will not let a guess replace a fact from the posting', async () => {
    const t = tables();
    t['job_search.roles'][0].location = 'London';
    t['job_search.fact_origins'] = [{ id: 'o1', user_id: ME, role_id: ROLE, field: 'location', origin: 'posting', certainty: 'firsthand' }];
    expect(await refused('change_role', t, { role_ref: ROLE, location: 'Paris' })).toMatch(/location on file came from the posting \(firsthand\)/);
    expect(t['job_search.roles'][0].location).toBe('London');

    await made('change_role', t, { role_ref: ROLE, location: 'Paris', fact_source: 'posting' });
    expect(t['job_search.fact_origins'][0]).toMatchObject({ origin: 'dash', certainty: 'firsthand' });
  });

  it('refuses fact_source email without the email', async () => {
    expect(await refused('change_role', tables(), { role_ref: ROLE, location: 'Paris', fact_source: 'email' })).toMatch(/needs email_ref/);
    expect(await refused('change_role', tables(), { role_ref: ROLE, location: 'Paris', email_ref: EMAIL })).toMatch(/goes with fact_source/);
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

  it('marks an application ready to apply and answers whether it has a cover letter (plan #2102.1)', async () => {
    const t = tables();
    const ready = await made('change_application', t, { application_ref: APP_1, ready_to_apply: true, has_cover_letter: false });
    expect(ready.after).toMatchObject({ ready_to_apply: true, has_cover_letter: false });
    expect(ready.summary).toBe(
      'Dash marked it ready to apply and marked that it has no cover letter for the role Role from email at Acme.',
    );
    const cleared = await made('change_application', t, { application_ref: APP_1, ready_to_apply: false, has_cover_letter: null });
    expect(cleared.before).toMatchObject({ ready_to_apply: true, has_cover_letter: false });
    expect(cleared.after).toMatchObject({ ready_to_apply: false, has_cover_letter: null });
  });

  it('marks that all of an application\'s questions are added', async () => {
    const t = tables();
    const done = await made('change_application', t, { application_ref: APP_1, all_questions_added: true });
    expect(done.after).toMatchObject({ all_questions_added: true });
    expect(done.summary).toBe('Dash marked that all its questions are added for the role Role from email at Acme.');
    const undone = await made('change_application', t, { application_ref: APP_1, all_questions_added: false });
    expect(undone.before).toMatchObject({ all_questions_added: true });
    expect(undone.after).toMatchObject({ all_questions_added: false });
  });

  it('refuses marks that are not true or false', async () => {
    expect(await refused('change_application', tables(), { application_ref: APP_1, all_questions_added: 'yes' })).toMatch(/true or false/);
    expect(await refused('change_application', tables(), { application_ref: APP_1, all_questions_added: null })).toMatch(/true or false/);
    expect(await refused('change_application', tables(), { application_ref: APP_1 })).toMatch(/all_questions_added/);
    expect(await refused('change_application', tables(), { application_ref: APP_1, ready_to_apply: 'yes' })).toMatch(/true or false/);
    expect(await refused('change_application', tables(), { application_ref: APP_1, ready_to_apply: null })).toMatch(/true or false/);
    expect(await refused('change_application', tables(), { application_ref: APP_1, has_cover_letter: 1 })).toMatch(/null to clear/);
  });

  it("refuses an application mark on someone else's application", async () => {
    const t = tables();
    const app = t['job_search.applications'].find((row) => row.id === APP_1)!;
    app.user_id = SOMEONE;
    expect(await refused('change_application', t, { application_ref: APP_1, ready_to_apply: true })).toMatch(/no application of theirs/);
    expect(app.ready_to_apply).toBeUndefined();
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

describe('change_reminder and change_waiting (plan #1894.6.3)', () => {
  const REMINDER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const MAILBOX = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const MESSAGE = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const DISMISSAL = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

  function withReminders(): FakeTables {
    return {
      ...tables(),
      'job_search.reminders': [
        { id: REMINDER, user_id: ME, application_id: APP_1, kind: 'custom', body: 'Send the take-home', due_at: '2026-10-10T00:00:00.000Z', completed_at: null, ingested_message_id: null },
        { id: LINK, user_id: SOMEONE, application_id: null, kind: 'custom', body: 'Not mine', due_at: '2026-10-10T00:00:00.000Z', completed_at: null, ingested_message_id: null },
      ],
      'job_search.inbox_messages': [
        { id: MESSAGE, user_id: ME, email_account_id: MAILBOX, provider_message_id: '18f2a', subject: 'Your take-home' },
      ],
      'job_search.application_events': [
        { id: EVENT, user_id: ME, application_id: APP_1, kind: 'email', summary: 'Asked for references', payload: { action_required: true } },
        { id: ANSWER_1, user_id: ME, application_id: APP_1, kind: 'email', summary: 'Thanks for applying', payload: {} },
      ],
      'job_search.waiting_dismissals': [],
    };
  }

  it('finishes a reminder, keeping the row as it was', async () => {
    const change = await made('change_reminder', withReminders(), { reminder_ref: REMINDER, finish: true });
    expect(change.op).toBe('update');
    expect(change.subjectRef).toBe(`job_search.reminders:${REMINDER}`);
    expect(change.before).toMatchObject({ completed_at: null });
    expect(change.after.completed_at).toEqual(expect.any(String));
    expect(change.summary).toBe('Dash finished the reminder "Send the take-home" on Role from email at Acme.');
    expect(change.undo).toBeNull();
  });

  it('puts one off to a day, rewords and moves one, and links it to an email by its search_mail ref', async () => {
    const off = await made('change_reminder', withReminders(), { reminder_ref: REMINDER, put_off: '2099-01-15' });
    expect(off.after.due_at).toBe('2099-01-15T00:00:00.000Z');
    expect(off.summary).toContain('put off until Thu 15 Jan 2099');
    const tomorrow = await made('change_reminder', withReminders(), { reminder_ref: REMINDER, put_off: 'tomorrow' });
    expect(new Date(tomorrow.after.due_at as string).getTime()).toBeGreaterThan(Date.now());

    const edited = await made('change_reminder', withReminders(), {
      reminder_ref: REMINDER,
      body: 'Submit the take-home',
      due: '2026-10-20',
      email_ref: `${MAILBOX}:18f2a`,
    });
    expect(edited.after).toMatchObject({ body: 'Submit the take-home', due_at: '2026-10-20T00:00:00.000Z', ingested_message_id: MESSAGE });
    expect(edited.summary).toContain('linked to the email "Your take-home"');
  });

  it('refuses a reminder that is not theirs, an email it has not taken in, and a call with nothing in it', async () => {
    expect(await refused('change_reminder', withReminders(), { reminder_ref: LINK, finish: true })).toMatch(/no reminder of theirs/);
    expect(await refused('change_reminder', withReminders(), { reminder_ref: REMINDER, email_ref: `${MAILBOX}:nope` })).toMatch(
      /not one the job search has read/,
    );
    expect(await refused('change_reminder', withReminders(), { reminder_ref: REMINDER })).toMatch(/Nothing to change/);
    expect(await refused('change_reminder', withReminders(), { reminder_ref: REMINDER, finish: true, put_off: 'tomorrow' })).toMatch(/not both/);
    expect(await refused('change_reminder', withReminders(), { reminder_ref: REMINDER, put_off: 'someday' })).toMatch(/put_off must be tomorrow/);
  });

  it('marks a waiting row done with a new row, whose Undo takes it out', async () => {
    const change = await made('change_waiting', withReminders(), { event_ref: EVENT, verb: 'finish' });
    expect(change.op).toBe('insert');
    expect(change.before).toBeNull();
    expect(change.after).toMatchObject({ user_id: ME, application_event_id: EVENT, dismissed_until: null });
    expect(change.subjectRef).toMatch(/^job_search\.waiting_dismissals:/);
    expect(change.summary).toBe('Dash marked done "Asked for references" on Role from email at Acme, from "Waiting on you" on Jobs Today.');
  });

  it('puts off a row already set aside in place, and refuses an event that asked nothing', async () => {
    const data = withReminders();
    data['job_search.waiting_dismissals'] = [{ id: DISMISSAL, user_id: ME, application_event_id: EVENT, dismissed_until: null }];
    const change = await made('change_waiting', data, { event_ref: EVENT, verb: 'put_off', until: '2099-01-15' });
    expect(change.op).toBe('update');
    expect(change.subjectRef).toBe(`job_search.waiting_dismissals:${DISMISSAL}`);
    expect(change.after.dismissed_until).toBe('2099-01-15T00:00:00.000Z');
    expect(await refused('change_waiting', data, { event_ref: EVENT, verb: 'put_off' })).toMatch(/until must be tomorrow/);
    expect(await refused('change_waiting', withReminders(), { event_ref: ANSWER_1, verb: 'finish' })).toMatch(/not one waiting on them/);
  });
});

describe('change_role_email (plan #1894.6.5)', () => {
  const MAILBOX = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const MESSAGE = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const OTHER = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2';

  function withMail(linkedTo: string | null = null): FakeTables {
    return {
      ...tables(),
      'job_search.inbox_messages': [
        { id: MESSAGE, user_id: ME, email_account_id: MAILBOX, provider_message_id: '18f2a', subject: 'Your application', classification: 'application_confirmation', received_at: '2026-10-01T10:00:00.000Z' },
        { id: OTHER, user_id: SOMEONE, email_account_id: MAILBOX, provider_message_id: 'zz', subject: 'Not mine', classification: 'rejection', received_at: '2026-10-01T10:00:00.000Z' },
      ],
      'job_search.ingested_messages': [
        { id: MESSAGE, resulting_application_id: linkedTo, parse_status: linkedTo ? 'parsed' : 'needs_review', link_method: linkedTo ? 'manual' : null, link_confidence: linkedTo ? 1 : null, error: null },
        { id: OTHER, resulting_application_id: null, parse_status: 'needs_review', link_method: null, link_confidence: null, error: null },
      ],
      'job_search.application_events': [],
      'job_search.message_link_dismissals': [],
    };
  }
  const deps = (t: FakeTables) => ({ userId: ME, db: async (schema: Parameters<ReturnType<typeof fakeSchemaDb>>[0]) => fakeSchemaDb(t)(schema) });

  it('links an email, filing its event, and its Undo takes both back', async () => {
    const t = withMail();
    const change = await made('change_role_email', t, { action: 'link', application_ref: APP_1, email_ref: MESSAGE });
    expect(change.subjectRef).toBe(`job_search.applications:${APP_1}`);
    expect(t['job_search.ingested_messages'][0]).toMatchObject({ resulting_application_id: APP_1, parse_status: 'parsed', link_method: 'manual' });
    expect(t['job_search.application_events']).toHaveLength(1);
    expect(t['job_search.application_events'][0]).toMatchObject({ user_id: ME, application_id: APP_1, kind: 'confirmation' });
    expect(change.summary).toBe('Dash linked "Your application" to the role on Role from email at Acme.');
    expect(await undoRoleEmail(deps(t), change.undo)).toMatchObject({ ok: true });
    expect(t['job_search.ingested_messages'][0]).toMatchObject({ resulting_application_id: null, parse_status: 'needs_review' });
    expect(t['job_search.application_events']).toHaveLength(0);
  });

  it('turns an email down, remembered for the pair, and the Undo forgets it', async () => {
    const t = withMail();
    const change = await made('change_role_email', t, { action: 'decline', role_ref: ROLE, email_ref: MESSAGE });
    expect(t['job_search.message_link_dismissals']).toHaveLength(1);
    expect(t['job_search.ingested_messages'][0].resulting_application_id).toBeNull();
    expect(await undoRoleEmail(deps(t), change.undo)).toMatchObject({ ok: true });
    expect(t['job_search.message_link_dismissals']).toHaveLength(0);
  });

  it('unlinks an email back to the queue, and the Undo puts its events and link back', async () => {
    const t = withMail(APP_1);
    t['job_search.application_events'] = [
      { id: EVENT, user_id: ME, application_id: APP_1, ingested_message_id: MESSAGE, kind: 'confirmation', summary: 'Your application' },
    ];
    const change = await made('change_role_email', t, { action: 'unlink', application_ref: APP_1, email_ref: MESSAGE });
    expect(t['job_search.application_events']).toHaveLength(0);
    expect(t['job_search.ingested_messages'][0]).toMatchObject({ resulting_application_id: null, parse_status: 'needs_review' });
    expect(t['job_search.message_link_dismissals']).toHaveLength(1);
    expect(await undoRoleEmail(deps(t), change.undo)).toMatchObject({ ok: true });
    expect(t['job_search.application_events']).toHaveLength(1);
    expect(t['job_search.ingested_messages'][0]).toMatchObject({ resulting_application_id: APP_1, parse_status: 'parsed' });
    expect(t['job_search.message_link_dismissals']).toHaveLength(0);
  });

  it('refuses mail that is not theirs, a link already made, one elsewhere, and an unlink of a stranger', async () => {
    expect(await refused('change_role_email', withMail(), { action: 'link', application_ref: APP_1, email_ref: OTHER })).toMatch(/not one the job search has read/);
    expect(await refused('change_role_email', withMail(APP_1), { action: 'link', application_ref: APP_1, email_ref: MESSAGE })).toMatch(/linked to this role already/);
    expect(await refused('change_role_email', withMail(APP_2), { action: 'link', application_ref: APP_1, email_ref: MESSAGE })).toMatch(/another role/);
    expect(await refused('change_role_email', withMail(), { action: 'unlink', application_ref: APP_1, email_ref: MESSAGE })).toMatch(/not linked to this role/);
    expect(await refused('change_role_email', withMail(), { action: 'nope', application_ref: APP_1, email_ref: MESSAGE })).toMatch(/action must be/);
  });
});

describe('review_application and review_events (plan #1894.6.4.1)', () => {
  const EVENT_2 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const THEIRS = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

  function withReview(): FakeTables {
    const t = tables();
    t['job_search.applications'] = [
      { id: APP_1, user_id: ME, role_id: ROLE, attempt: 1, status: 'applied', needs_review: true, status_manual_override: null },
      { id: APP_2, user_id: ME, role_id: ROLE, attempt: 2, status: 'rejected', needs_review: false, status_manual_override: null },
      { id: THEIRS, user_id: SOMEONE, role_id: ROLE, attempt: 3, status: 'applied', needs_review: true, status_manual_override: null },
    ];
    t['job_search.application_events'] = [
      { id: EVENT, user_id: ME, application_id: APP_2, kind: 'interview_scheduled', summary: 'Invite after a rejection', needs_review: true, acknowledged_at: null },
      { id: EVENT_2, user_id: ME, application_id: APP_2, kind: 'email', summary: 'Following up', needs_review: true, acknowledged_at: null },
      { id: THEIRS, user_id: SOMEONE, application_id: THEIRS, kind: 'email', summary: 'Not mine', needs_review: true, acknowledged_at: null },
    ];
    return t;
  }
  const undoOn = (t: FakeTables) => ({ userId: ME, db: async (schema: Parameters<ReturnType<typeof fakeSchemaDb>>[0]) => fakeSchemaDb(t)(schema) });

  it('confirms an application the inbox found, and its Undo flags it again', async () => {
    const t = withReview();
    const change = await made('review_application', t, { application_ref: APP_1, verb: 'confirm' });
    expect(change.subjectRef).toBe(`job_search.applications:${APP_1}`);
    expect(change.after).toMatchObject({ needs_review: false });
    expect(change.summary).toBe('Dash confirmed Role from email at Acme as a real pursuit, from Jobs review.');
    expect(await undoJobsRows(undoOn(t), change.undo)).toMatchObject({ ok: true, restored: 1 });
    expect(t['job_search.applications'][0]).toMatchObject({ needs_review: true });
  });

  it('reopens a closed pursuit with its timeline line, and its Undo takes both back', async () => {
    const t = withReview();
    const change = await made('review_application', t, { application_ref: APP_2, verb: 'reopen', status: 'in_process' });
    expect(change.after).toMatchObject({ status_manual_override: 'in_process' });
    const line = t['job_search.application_events'].find((e) => e.kind === 'status_override');
    expect(line).toMatchObject({ user_id: ME, application_id: APP_2, source: 'manual', summary: 'Reopened by hand as in process' });
    expect(change.summary).toBe('Dash reopened the pursuit Role from email at Acme as in process.');

    expect(await undoJobsRows(undoOn(t), change.undo)).toMatchObject({ ok: true, restored: 2 });
    expect(t['job_search.applications'][1]).toMatchObject({ status_manual_override: null });
    expect(t['job_search.application_events'].some((e) => e.kind === 'status_override')).toBe(false);
  });

  it('keeps the timeline line when the pursuit has moved on since', async () => {
    const t = withReview();
    const change = await made('review_application', t, { application_ref: APP_2, verb: 'reopen', status: 'final_round' });
    t['job_search.applications'][1].status_manual_override = 'offer';
    expect(await undoJobsRows(undoOn(t), change.undo)).toMatchObject({ ok: false });
    expect(t['job_search.application_events'].some((e) => e.kind === 'status_override')).toBe(true);
  });

  it('refuses an open pursuit to reopen, one already confirmed, and one that is not theirs', async () => {
    expect(await refused('review_application', withReview(), { application_ref: APP_1, verb: 'reopen', status: 'in_process' })).toMatch(/not closed/);
    expect(await refused('review_application', withReview(), { application_ref: APP_2, verb: 'confirm' })).toMatch(/not waiting/);
    expect(await refused('review_application', withReview(), { application_ref: THEIRS, verb: 'confirm' })).toMatch(/no application of theirs/);
    expect(await refused('review_application', withReview(), { application_ref: APP_2, verb: 'reopen' })).toMatch(/status must be one of/);
  });

  it('acknowledges flagged events, and its Undo flags each again', async () => {
    const t = withReview();
    const change = await made('review_events', t, { event_refs: [EVENT, EVENT_2], verb: 'acknowledge' });
    const mine = () => t['job_search.application_events'].slice(0, 2);
    expect(mine().every((e) => e.needs_review === false && typeof e.acknowledged_at === 'string')).toBe(true);
    expect(change.summary).toBe('Dash acknowledged 2 events on Role from email at Acme in Jobs review.');
    expect(await undoJobsRows(undoOn(t), change.undo)).toMatchObject({ ok: true, restored: 2 });
    expect(mine().every((e) => e.needs_review === true && e.acknowledged_at === null)).toBe(true);
  });

  it('takes an acknowledgement back, and refuses an event that is not theirs or one with nothing to do', async () => {
    const t = withReview();
    t['job_search.application_events'][0] = { ...t['job_search.application_events'][0], needs_review: false, acknowledged_at: '2026-10-01T00:00:00.000Z' };
    const change = await made('review_events', t, { event_refs: [EVENT], verb: 'take_back' });
    expect(t['job_search.application_events'][0]).toMatchObject({ needs_review: true, acknowledged_at: null });
    expect(change.summary).toBe('Dash took back the acknowledgement of "Invite after a rejection" on Role from email at Acme in Jobs review.');

    expect(await refused('review_events', withReview(), { event_refs: [EVENT, THEIRS], verb: 'acknowledge' })).toMatch(/not an event of theirs/);
    expect(await refused('review_events', withReview(), { event_refs: [EVENT], verb: 'take_back' })).toMatch(/None of those has been acknowledged/);
  });
});

describe('contacts, touches and suggestions (plan #1894.6.6)', () => {
  const TOUCH = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const SUGGESTION = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
  const SUGGESTION_2 = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2';

  function people(): FakeTables {
    return {
      ...tables(),
      'job_search.contacts': [
        { id: CONTACT, user_id: ME, full_name: 'Sam Lee', title: null, email: null, company_id: COMPANY, status: 'to_contact', relationship: 'cold' },
      ],
      'job_search.contact_touches': [],
      'job_search.notes': [],
      'job_search.reminders': [],
      'job_search.attachments': [],
      'job_search.interview_participants': [],
      'job_search.suggestions': [
        {
          id: SUGGESTION,
          user_id: ME,
          kind: 'reach_out',
          status: 'open',
          contact_id: null,
          person_name: 'Priya Rao',
          person_title: 'Data Lead',
          company_name: 'Acme',
          channel: 'linkedin_dm',
          message: 'Hi Priya',
          headline: 'Ask Priya about the team',
          source_url: 'https://www.linkedin.com/in/priya',
        },
        { id: SUGGESTION_2, user_id: ME, kind: 'reach_out', status: 'open', contact_id: null, person_name: 'Priya Shah', headline: 'Meet Priya Shah', channel: null, message: null },
      ],
      'todo.task_links': [],
    };
  }
  const deps = (t: FakeTables) => ({ userId: ME, db: async (schema: Parameters<ReturnType<typeof fakeSchemaDb>>[0]) => fakeSchemaDb(t)(schema) });

  it('adds a contact at a company on file, and its Undo takes it out', async () => {
    const t = people();
    const change = await made('change_contact', t, { full_name: 'Jo Park', company: 'Acme', relationship: 'alum' });
    expect(change.op).toBe('insert');
    expect(t['job_search.contacts']).toHaveLength(2);
    expect(t['job_search.contacts'][1]).toMatchObject({ user_id: ME, full_name: 'Jo Park', company_id: COMPANY, relationship: 'alum' });
    expect(change.summary).toBe('Dash added Jo Park at Acme to the contacts.');
    expect(await undoContactRows(deps(t), change.undo)).toMatchObject({ ok: true });
    expect(t['job_search.contacts']).toHaveLength(1);
  });

  it("corrects a contact, and refuses a bad link, no change and someone else's contact", async () => {
    const t = people();
    const change = await made('change_contact', t, { contact_ref: CONTACT, title: 'Staff Engineer', email: 'sam@acme.com' });
    expect(t['job_search.contacts'][0]).toMatchObject({ title: 'Staff Engineer', email: 'sam@acme.com' });
    expect(change.summary).toBe('Dash updated the contact Sam Lee at Acme.');
    expect(await undoContactRows(deps(t), change.undo)).toMatchObject({ ok: true });
    expect(t['job_search.contacts'][0]).toMatchObject({ title: null, email: null });
    expect(await refused('change_contact', people(), { contact_ref: CONTACT, linkedin_url: 'linkedin' })).toMatch(/must be a link/);
    expect(await refused('change_contact', people(), { contact_ref: CONTACT, full_name: 'Sam Lee' })).toMatch(/Nothing to change/);
    expect(await refused('change_contact', people(), {})).toMatch(/needs a name/);
    const theirs = people();
    theirs['job_search.contacts'][0].user_id = SOMEONE;
    expect(await refused('change_contact', theirs, { contact_ref: CONTACT, title: 'x' })).toMatch(/no contact of theirs/);
  });

  it('logs a touch, moving the contact to contacted, and the Undo puts both back', async () => {
    const t = people();
    const change = await made('change_touch', t, { action: 'log', contact_ref: CONTACT, channel: 'email', message: 'Coffee?' });
    expect(t['job_search.contact_touches']).toHaveLength(1);
    expect(t['job_search.contact_touches'][0]).toMatchObject({ user_id: ME, contact_id: CONTACT, channel: 'email', direction: 'outbound', message: 'Coffee?' });
    expect(t['job_search.contacts'][0].status).toBe('contacted');
    expect(change.summary).toBe('Dash logged an email to Sam Lee, in the outreach log.');
    expect(await undoContactRows(deps(t), change.undo)).toMatchObject({ ok: true, restored: 2 });
    expect(t['job_search.contact_touches']).toHaveLength(0);
    expect(t['job_search.contacts'][0].status).toBe('to_contact');
  });

  it('marks a touch answered, then corrects it, each undone', async () => {
    const t = people();
    t['job_search.contact_touches'] = [
      { id: TOUCH, user_id: ME, contact_id: CONTACT, channel: 'linkedin_dm', direction: 'outbound', message: 'Hi', responded_at: null, response_summary: null },
    ];
    const answered = await made('change_touch', t, { action: 'answered', touch_ref: TOUCH, response: 'Happy to chat' });
    expect(t['job_search.contact_touches'][0]).toMatchObject({ response_summary: 'Happy to chat', responded_at: expect.any(String) });
    expect(t['job_search.contacts'][0].status).toBe('responded');
    expect(await refused('change_touch', t, { action: 'answered', touch_ref: TOUCH })).toMatch(/answered already/);
    expect(await undoContactRows(deps(t), answered.undo)).toMatchObject({ ok: true });
    expect(t['job_search.contact_touches'][0]).toMatchObject({ responded_at: null, response_summary: null });
    expect(t['job_search.contacts'][0].status).toBe('to_contact');
    const edited = await made('change_touch', t, { action: 'edit', touch_ref: TOUCH, channel: 'email' });
    expect(t['job_search.contact_touches'][0].channel).toBe('email');
    expect(await undoContactRows(deps(t), edited.undo)).toMatchObject({ ok: true });
    expect(t['job_search.contact_touches'][0].channel).toBe('linkedin_dm');
    expect(await refused('change_touch', t, { action: 'edit', touch_ref: TOUCH, channel: 'linkedin_dm' })).toMatch(/Nothing to change/);
  });

  it('marks a suggestion sent by name, adding the contact and the touch, and the Undo takes them out', async () => {
    const t = people();
    const change = await made('mark_suggestion_sent', t, { person: 'Priya Rao' });
    expect(t['job_search.contacts']).toHaveLength(2);
    expect(t['job_search.contacts'][1]).toMatchObject({
      full_name: 'Priya Rao',
      company_id: COMPANY,
      status: 'contacted',
      linkedin_url: 'https://www.linkedin.com/in/priya',
    });
    expect(t['job_search.contact_touches'][0]).toMatchObject({ channel: 'linkedin_dm', direction: 'outbound', message: 'Hi Priya' });
    expect(t['job_search.suggestions'][0]).toMatchObject({ status: 'done', contact_id: t['job_search.contacts'][1].id });
    expect(change.summary).toBe(
      'Dash marked the suggestion to message Priya Rao as sent, logging it in the outreach log and adding them as a contact.',
    );
    expect(await refused('mark_suggestion_sent', t, { suggestion_ref: SUGGESTION })).toMatch(/marked sent already/);
    expect(await undoContactRows(deps(t), change.undo)).toMatchObject({ ok: true });
    expect(t['job_search.contacts']).toHaveLength(1);
    expect(t['job_search.contact_touches']).toHaveLength(0);
    expect(t['job_search.suggestions'][0]).toMatchObject({ status: 'open', contact_id: null });
  });

  it('leaves an added contact that has gathered a note since, and refuses an unclear name', async () => {
    const t = people();
    const change = await made('mark_suggestion_sent', t, { suggestion_ref: SUGGESTION });
    const added = t['job_search.contacts'][1].id;
    t['job_search.notes'].push({ id: 'note-1', user_id: ME, contact_id: added, body: 'Met at the meetup' });
    expect(await undoContactRows(deps(t), change.undo)).toMatchObject({ ok: true });
    expect(t['job_search.contacts']).toHaveLength(2);
    expect(t['job_search.suggestions'][0].status).toBe('open');
    expect(await refused('mark_suggestion_sent', people(), { person: 'Priya' })).toMatch(/More than one/);
    expect(await refused('mark_suggestion_sent', people(), { person: 'Nobody' })).toMatch(/No open suggestion/);
  });
});

describe('review_emails (plan #1894.6.4.2)', () => {
  const MAIL_1 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1';
  const MAIL_2 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2';
  const GONE = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3';
  const THEIRS = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4';
  const MAILBOX = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

  function withMail(): FakeTables {
    const t = tables();
    const verdicts = [
      { id: MAIL_1, classification: 'interview_invite', parse_status: 'needs_review', resulting_application_id: APP_1, link_method: 'thread', link_confidence: 0.6, error: null },
      { id: MAIL_2, classification: 'recruiter_reply', parse_status: 'needs_review', resulting_application_id: null, link_method: null, link_confidence: null, error: 'no role found' },
      { id: GONE, classification: 'not_relevant', parse_status: 'skipped', resulting_application_id: null, link_method: null, link_confidence: null, error: null },
      { id: THEIRS, classification: 'offer', parse_status: 'needs_review', resulting_application_id: null, link_method: null, link_confidence: null, error: null },
    ];
    t['job_search.ingested_messages'] = verdicts.map((row) => ({ ...row }));
    t['job_search.inbox_messages'] = verdicts.map((row, i) => ({
      ...row,
      user_id: row.id === THEIRS ? SOMEONE : ME,
      email_account_id: MAILBOX,
      provider_message_id: `m${i + 1}`,
      subject: ['Interview next week', 'Re: your application', 'Newsletter', 'Not mine'][i],
    }));
    return t;
  }
  const undoOn = (t: FakeTables) => ({ userId: ME, db: async (schema: Parameters<ReturnType<typeof fakeSchemaDb>>[0]) => fakeSchemaDb(t)(schema) });
  const verdict = (t: FakeTables, id: string) => t['job_search.ingested_messages'].find((row) => row.id === id)!;

  it("dismisses waiting emails as the page does, and its Undo puts back each one's own classification and link", async () => {
    const t = withMail();
    const change = await made('review_emails', t, { email_refs: [MAIL_1, `${MAILBOX}:m2`], verb: 'dismiss' });
    expect(change.kind).toBe('review_emails');
    expect(change.summary).toBe('Dash dismissed 2 emails from Jobs review.');
    for (const id of [MAIL_1, MAIL_2]) {
      expect(verdict(t, id)).toMatchObject({ classification: 'not_relevant', parse_status: 'skipped', resulting_application_id: null, link_method: null, error: null });
    }

    expect(await undoJobsRows(undoOn(t), change.undo)).toMatchObject({ ok: true, restored: 2 });
    expect(verdict(t, MAIL_1)).toMatchObject({ classification: 'interview_invite', parse_status: 'needs_review', resulting_application_id: APP_1, link_method: 'thread', link_confidence: 0.6 });
    expect(verdict(t, MAIL_2)).toMatchObject({ classification: 'recruiter_reply', parse_status: 'needs_review', error: 'no role found' });
  });

  it('brings a dismissed email back, as the kind they say, and its Undo dismisses it again', async () => {
    const t = withMail();
    const change = await made('review_emails', t, { email_refs: [`job_search.inbox_messages:${GONE}`], verb: 'restore', classification: 'job_alert' });
    expect(verdict(t, GONE)).toMatchObject({ classification: 'job_alert', parse_status: 'needs_review' });
    expect(change.summary).toBe('Dash brought back "Newsletter" to Jobs review as job alert.');
    expect(await undoJobsRows(undoOn(t), change.undo)).toMatchObject({ ok: true, restored: 1 });
    expect(verdict(t, GONE)).toMatchObject({ classification: 'not_relevant', parse_status: 'skipped' });
  });

  it('leaves an email that has moved on since alone on Undo', async () => {
    const t = withMail();
    const change = await made('review_emails', t, { email_refs: [MAIL_1], verb: 'dismiss' });
    Object.assign(verdict(t, MAIL_1), { classification: 'offer', parse_status: 'parsed' });
    expect(await undoJobsRows(undoOn(t), change.undo)).toMatchObject({ ok: false });
    expect(verdict(t, MAIL_1)).toMatchObject({ classification: 'offer' });
  });

  it("refuses another person's email, one with nothing to do, and a classification on a dismissal", async () => {
    expect(await refused('review_emails', withMail(), { email_refs: [MAIL_1, THEIRS], verb: 'dismiss' })).toMatch(/not an email the job search has read/);
    expect(await refused('review_emails', withMail(), { email_refs: [GONE], verb: 'dismiss' })).toMatch(/None of those is waiting/);
    expect(await refused('review_emails', withMail(), { email_refs: [MAIL_1], verb: 'restore' })).toMatch(/None of those has been dismissed/);
    expect(await refused('review_emails', withMail(), { email_refs: [MAIL_1], verb: 'dismiss', classification: 'offer' })).toMatch(/goes with restore/);
    expect(await refused('review_emails', withMail(), { email_refs: [], verb: 'dismiss' })).toMatch(/Name the emails/);
  });
});

describe('add_role_from_email (plan #1894.6.4.3)', () => {
  const MAIL = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1';
  const LINKED = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2';
  const THEIRS = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3';
  const MAILBOX = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

  function withMail(): FakeTables {
    const t = tables();
    const verdicts = [
      { id: MAIL, classification: 'rejection', parse_status: 'needs_review', resulting_application_id: null, link_method: null, link_confidence: null, error: 'no role found' },
      { id: LINKED, classification: 'recruiter_outreach', parse_status: 'parsed', resulting_application_id: APP_1, link_method: 'thread', link_confidence: 1, error: null },
      { id: THEIRS, classification: 'offer', parse_status: 'needs_review', resulting_application_id: null, link_method: null, link_confidence: null, error: null },
    ];
    t['job_search.ingested_messages'] = verdicts.map((row) => ({ ...row }));
    t['job_search.inbox_messages'] = verdicts.map((row, i) => ({
      ...row,
      user_id: row.id === THEIRS ? SOMEONE : ME,
      email_account_id: MAILBOX,
      provider_message_id: `m${i + 1}`,
      subject: ['Update on your application', 'A role for you', 'Not mine'][i],
      received_at: '2026-10-01T10:00:00.000Z',
    }));
    t['job_search.application_events'] = [];
    t['job_search.notes'] = [];
    return t;
  }
  const undoOn = (t: FakeTables) => ({ userId: ME, db: async (schema: Parameters<ReturnType<typeof fakeSchemaDb>>[0]) => fakeSchemaDb(t)(schema) });

  it('makes the company, role and application and links the email, and its Undo takes all four back', async () => {
    const t = withMail();
    const change = await made('add_role_from_email', t, { email_ref: `${MAILBOX}:m1`, company: 'Globex', title: 'Data Engineer' });
    const globex = t['job_search.companies'].find((c) => c.name === 'Globex')!;
    const role = t['job_search.roles'].find((r) => r.title === 'Data Engineer')!;
    const application = t['job_search.applications'].find((a) => a.role_id === role.id)!;
    expect(role).toMatchObject({ user_id: ME, company_id: globex.id, source: 'portal' });
    expect(application).toMatchObject({ user_id: ME, source: 'portal', created_by: 'manual' });
    expect(t['job_search.ingested_messages'][0]).toMatchObject({ resulting_application_id: application.id, parse_status: 'parsed', link_method: 'manual' });
    expect(t['job_search.application_events']).toEqual([expect.objectContaining({ application_id: application.id, kind: 'rejection', ingested_message_id: MAIL })]);
    expect(change).toMatchObject({ kind: 'add_role_from_email', op: 'insert', subjectRef: `job_search.roles:${role.id}` });
    expect(change.summary).toBe(
      'Dash made the role Data Engineer at Globex from "Update on your application" in Jobs review, adding the company, and linked the email to it.',
    );

    expect(await undoRoleFromEmail(undoOn(t), change.undo)).toMatchObject({ ok: true });
    expect(t['job_search.ingested_messages'][0]).toMatchObject({ resulting_application_id: null, parse_status: 'needs_review', error: 'no role found' });
    expect(t['job_search.application_events']).toHaveLength(0);
    expect(t['job_search.roles'].find((r) => r.id === role.id)).toBeUndefined();
    expect(t['job_search.applications'].find((a) => a.id === application.id)).toBeUndefined();
    expect(t['job_search.companies'].find((c) => c.id === globex.id)).toBeUndefined();
  });

  it('files the role under a company on file, and keeps a role that has gathered a note on Undo', async () => {
    const t = withMail();
    const change = await made('add_role_from_email', t, { email_ref: MAIL, company: 'acme', title: 'Analyst' });
    const role = t['job_search.roles'].find((r) => r.title === 'Analyst')!;
    expect(role.company_id).toBe(COMPANY);
    t['job_search.notes'].push({ id: LINK, user_id: ME, role_id: role.id, body: 'Ask about the team' });
    expect(await undoRoleFromEmail(undoOn(t), change.undo)).toMatchObject({ ok: false, error: expect.stringMatching(/gathered more/) });
    expect(t['job_search.roles'].find((r) => r.id === role.id)).toBeDefined();
    expect(t['job_search.application_events']).toHaveLength(1);
    expect(t['job_search.companies'].find((c) => c.id === COMPANY)).toBeDefined();
  });

  it('refuses a role already on file, a linked email, mail that is not theirs and a missing title', async () => {
    expect(await refused('add_role_from_email', withMail(), { email_ref: MAIL, company: 'Acme', title: 'role from email' })).toMatch(/on file already.*change_role_email/);
    expect(await refused('add_role_from_email', withMail(), { email_ref: LINKED, company: 'Globex', title: 'Data Engineer' })).toMatch(/linked to a role already/);
    expect(await refused('add_role_from_email', withMail(), { email_ref: THEIRS, company: 'Globex', title: 'Data Engineer' })).toMatch(/not one the job search has read/);
    expect(await refused('add_role_from_email', withMail(), { email_ref: MAIL, company: 'Globex' })).toMatch(/Give title/);
  });
});
