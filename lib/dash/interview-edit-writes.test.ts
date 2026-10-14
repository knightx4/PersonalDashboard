import { describe, expect, it } from 'vitest';
import type { AskSchema } from '@/lib/ask/db';
import { fakeSchemaDb, type FakeTables } from '../../tests/stubs/fake-schema-db';
import { INTERVIEW_EDIT_WRITES, undoInterviewRows } from './interview-edit-writes';
import { JOBS_WRITES, runJobsWrite, type JobsWriteEnv } from './jobs-writes';

/**
 * The interview edits (plan #1894.6.9): an interview named by its role and
 * round, its interviewers, and its rounds gathered, split, renamed or freed
 * of an email, each with what its Undo needs.
 */

const ME = '00000000-0000-4000-8000-0000000000aa';
const SOMEONE = '00000000-0000-4000-8000-0000000000bb';
const ROLE = '11111111-1111-4111-8111-111111111111';
const APP = '22222222-2222-4222-8222-222222222222';
const COMPANY = '33333333-3333-4333-8333-333333333333';
const R1 = '44444444-4444-4444-8444-444444444441';
const R2 = '44444444-4444-4444-8444-444444444442';
const I1 = '55555555-5555-4555-8555-555555555551';
const I2 = '55555555-5555-4555-8555-555555555552';
const I3 = '55555555-5555-4555-8555-555555555553';
const CONTACT = '66666666-6666-4666-8666-666666666666';
const MSG = '77777777-7777-4777-8777-777777777777';
const LINK = '88888888-8888-4888-8888-888888888888';
const ACCOUNT = '99999999-9999-4999-8999-999999999999';

function tables(): FakeTables {
  return {
    'core.account_settings': [{ user_id: ME, timezone: 'Europe/London' }],
    'job_search.companies': [{ id: COMPANY, user_id: ME, name: 'Acme' }],
    'job_search.roles': [{ id: ROLE, user_id: ME, title: 'Data Engineer', company_id: COMPANY }],
    'job_search.applications': [{ id: APP, user_id: ME, role_id: ROLE, attempt: 1 }],
    'job_search.interview_groups': [
      { id: R1, user_id: ME, application_id: APP, round_number: 1, label: null, notes: null },
      { id: R2, user_id: ME, application_id: APP, round_number: 2, label: 'Onsite', notes: null },
    ],
    'job_search.interviews': [
      { id: I1, user_id: ME, application_id: APP, group_id: R1, round: 1, kind: 'recruiter_screen', status: 'scheduled', scheduled_at: null, time_known: false, notes: null, prep_notes: null },
      { id: I2, user_id: ME, application_id: APP, group_id: R2, round: 1, kind: 'technical', status: 'scheduled', scheduled_at: null, time_known: false, notes: null, prep_notes: null },
      { id: I3, user_id: ME, application_id: APP, group_id: R2, round: 2, kind: 'hiring_manager', status: 'scheduled', scheduled_at: null, time_known: false, notes: null, prep_notes: null },
    ],
    'job_search.interview_participants': [],
    'job_search.contacts': [{ id: CONTACT, user_id: ME, full_name: 'Priya Shah', company_id: COMPANY }],
    'job_search.interview_group_messages': [{ id: LINK, user_id: ME, group_id: R2, message_id: MSG }],
    'job_search.inbox_messages': [{ id: MSG, user_id: ME, email_account_id: ACCOUNT, provider_message_id: 'abc' }],
  };
}

function env(t: FakeTables): JobsWriteEnv {
  const db = fakeSchemaDb(t);
  return { userId: ME, jobs: db('job_search'), todo: db('todo'), core: db('core') };
}

const deps = (t: FakeTables) => {
  const db = fakeSchemaDb(t);
  return { userId: ME, db: async (schema: AskSchema) => db(schema) };
};

const write = (name: string) => INTERVIEW_EDIT_WRITES.find((entry) => entry.name === name)!;

async function made(name: string, t: FakeTables, input: Record<string, unknown>) {
  const result = await runJobsWrite(write(name), env(t), input);
  if ('ok' in result) throw new Error(result.error);
  return result;
}

async function refused(name: string, t: FakeTables, input: Record<string, unknown>) {
  const result = await runJobsWrite(write(name), env(t), input);
  if (!('ok' in result)) throw new Error('expected a refusal');
  return result.error;
}

const interview = (t: FakeTables, id: string) => t['job_search.interviews'].find((row) => row.id === id)!;

describe('the interview edits', () => {
  it('run among the Jobs writes, together', () => {
    const at = JOBS_WRITES.indexOf(INTERVIEW_EDIT_WRITES[0]);
    expect(JOBS_WRITES.slice(at, at + INTERVIEW_EDIT_WRITES.length)).toEqual([...INTERVIEW_EDIT_WRITES]);
  });

  it('corrects an interview named by its role and round, in their timezone', async () => {
    const t = tables();
    const change = await made('change_interview', t, { role_ref: ROLE, round_number: 1, kind: 'hiring_manager', date: '2026-10-20', time: '14:30', status: 'completed' });
    expect(change).toMatchObject({ kind: 'change_interview', op: 'update', undo: null, subjectRef: `job_search.interviews:${I1}` });
    expect(interview(t, I1)).toMatchObject({ kind: 'hiring_manager', status: 'completed', scheduled_at: '2026-10-20T13:30:00.000Z', time_known: true });
    expect(change.summary).toBe('Dash changed the recruiter screen interview in round 1 of Data Engineer at Acme: made it hiring manager, marked it done and moved it to 2026-10-20 at 14:30.');
  });

  it('asks which interview when the round holds several, and refuses another account', async () => {
    const t = tables();
    expect(await refused('change_interview', t, { role_ref: ROLE, round_number: 2, notes: 'x' })).toMatch(/holds 2 interviews \(1 Technical, 2 Hiring manager\)/);
    await made('change_interview', t, { role_ref: ROLE, round_number: 2, interview: 2, notes: 'Went well.' });
    expect(interview(t, I3).notes).toBe('Went well.');
    t['job_search.roles'][0].user_id = SOMEONE;
    expect(await refused('change_interview', t, { role_ref: ROLE, round_number: 1, notes: 'x' })).toMatch(/no role of theirs/);
    expect(await refused('change_interview', tables(), { interview_ref: I1, kind: 'recruiter_screen' })).toMatch(/Nothing to change/);
  });

  it('names an interviewer from their contacts, and takes them off again, with an Undo each way', async () => {
    const t = tables();
    const added = await made('change_interviewer', t, { action: 'add', interview_ref: I2, name: 'priya shah' });
    expect(t['job_search.interview_participants']).toEqual([expect.objectContaining({ interview_id: I2, contact_id: CONTACT, role: 'interviewer' })]);
    expect(t['job_search.contacts']).toHaveLength(1);
    expect(await refused('change_interviewer', t, { action: 'add', interview_ref: I2, contact_ref: CONTACT })).toMatch(/already named/);

    const removed = await made('change_interviewer', t, { action: 'remove', interview_ref: I2, contact_ref: CONTACT });
    expect(t['job_search.interview_participants']).toHaveLength(0);
    expect(removed.summary).toBe('Dash took Priya Shah off the technical interview in round 2, Onsite of Data Engineer at Acme.');
    expect(await undoInterviewRows(deps(t), removed.undo)).toEqual({ ok: true, restored: 1 });
    expect(t['job_search.interview_participants']).toHaveLength(1);
    expect(await undoInterviewRows(deps(t), added.undo)).toEqual({ ok: true, restored: 1 });
    expect(t['job_search.interview_participants']).toHaveLength(0);
  });

  it('adds someone new as a contact at the company, and the Undo takes both out', async () => {
    const t = tables();
    const change = await made('change_interviewer', t, { action: 'add', role_ref: ROLE, round_number: 1, name: 'Sam Lee' });
    const sam = t['job_search.contacts'][1];
    expect(sam).toMatchObject({ user_id: ME, full_name: 'Sam Lee', company_id: COMPANY, relationship: 'interviewer' });
    expect(change.summary).toMatch(/as a new contact\.$/);
    expect(await undoInterviewRows(deps(t), change.undo)).toEqual({ ok: true, restored: 2 });
    expect(t['job_search.contacts']).toHaveLength(1);
  });

  it('renames a round and the Undo puts the name back', async () => {
    const t = tables();
    const change = await made('change_interview_round', t, { action: 'edit', role_ref: ROLE, round_number: 2, label: 'Superday', notes: 'Long day.' });
    expect(t['job_search.interview_groups'][1]).toMatchObject({ label: 'Superday', notes: 'Long day.' });
    await undoInterviewRows(deps(t), change.undo);
    expect(t['job_search.interview_groups'][1]).toMatchObject({ label: 'Onsite', notes: null });
  });

  it('gathers rounds into the first, takes out the emptied one, and the Undo puts it all back', async () => {
    const t = tables();
    const change = await made('change_interview_round', t, { action: 'group', role_ref: ROLE, round_numbers: [2, 1] });
    expect(t['job_search.interview_groups'].map((row) => row.id)).toEqual([R1]);
    expect([I1, I2, I3].map((id) => [interview(t, id).group_id, interview(t, id).round])).toEqual([[R1, 1], [R1, 2], [R1, 3]]);
    expect(t['job_search.interview_group_messages'][0].group_id).toBe(R1);
    expect(change.summary).toBe('Dash gathered round 2 into round 1 of Data Engineer at Acme.');

    await undoInterviewRows(deps(t), change.undo);
    expect(t['job_search.interview_groups'].map((row) => row.id).sort()).toEqual([R1, R2]);
    expect([I2, I3].map((id) => interview(t, id).group_id)).toEqual([R2, R2]);
    expect(t['job_search.interview_group_messages'][0].group_id).toBe(R2);
  });

  it('refuses to gather a round that has notes of its own', async () => {
    const t = tables();
    t['job_search.interview_groups'][1].notes = 'Felt rushed.';
    expect(await refused('change_interview_round', t, { action: 'group', role_ref: ROLE, round_numbers: [1, 2] })).toMatch(/has notes of its own/);
  });

  it('splits an interview into a round of its own, numbered after the others', async () => {
    const t = tables();
    const change = await made('change_interview_round', t, { action: 'split', role_ref: ROLE, round_number: 2, interview: 2 });
    const fresh = t['job_search.interview_groups'][2];
    expect(fresh).toMatchObject({ application_id: APP, round_number: 3 });
    expect(interview(t, I3)).toMatchObject({ group_id: fresh.id, round: 1 });
    expect(await refused('change_interview_round', t, { action: 'split', interview_ref: I1 })).toMatch(/only interview in its round/);
    expect(await undoInterviewRows(deps(t), change.undo)).toEqual({ ok: true, restored: 2 });
    expect(interview(t, I3).group_id).toBe(R2);
    expect(t['job_search.interview_groups']).toHaveLength(2);
  });

  it('takes an email off a round, by its search_mail ref or as the only one, and the Undo puts it back', async () => {
    const t = tables();
    expect(await refused('change_interview_round', t, { action: 'detach_email', role_ref: ROLE, round_number: 1 })).toMatch(/no email attached/);
    const change = await made('change_interview_round', t, { action: 'detach_email', role_ref: ROLE, round_number: 2, message_ref: `${ACCOUNT}:abc` });
    expect(t['job_search.interview_group_messages']).toHaveLength(0);
    await undoInterviewRows(deps(t), change.undo);
    expect(t['job_search.interview_group_messages']).toEqual([expect.objectContaining({ id: LINK, group_id: R2 })]);
  });

  it('refuses an Undo once the round has changed again', async () => {
    const t = tables();
    const change = await made('change_interview_round', t, { action: 'edit', role_ref: ROLE, round_number: 1, label: 'Screen' });
    t['job_search.interview_groups'][0].label = 'Phone screen';
    expect(await undoInterviewRows(deps(t), change.undo)).toMatchObject({ ok: false });
  });
});
