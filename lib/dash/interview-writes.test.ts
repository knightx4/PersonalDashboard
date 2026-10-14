import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AskContext } from '@/lib/ask/db';
import { undoChange, type ChangeDeps } from '@/lib/ask/changes';
import { INTERVIEW_CHANGE_KINDS } from '@/lib/ask/interview-changes';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { insertMadeChange, type MadeDashChange } from '@/lib/talk/changes';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { fakeSchemaDb, type FakeTables } from '../../tests/stubs/fake-schema-db';
import type { PrepNote } from '@/lib/jobs/interview/prep-payload';
import type { PrepareRoundResult } from '@/lib/jobs/interview/prepare-round';
import { INTERVIEW_WRITE_TOOLS } from './interview-writes';
import type { DashWriteContext, DashWriteResult } from './registry';

// The note itself is written by prepareRound, which reads through embedded
// joins the in-memory database does not serve and calls the model; these
// tests cover the tool around it.
const prepareRound = vi.fn<(...args: unknown[]) => Promise<PrepareRoundResult>>();
const recordSessionSpend = vi.fn(async () => undefined);
vi.mock('@/lib/jobs/interview/prepare-round', () => ({ prepareRound: (...args: unknown[]) => prepareRound(...args) }));
vi.mock('@/lib/core/spend/session', () => ({ recordSessionSpend: (...args: unknown[]) => recordSessionSpend(...(args as [])) }));

/**
 * A round Dash adds to a role when asked (plan #2044.1): made the way the
 * role page makes one, refused on a role that is not the person's, and undone
 * from its record while nothing has been written on it.
 */

const ME = '00000000-0000-4000-8000-0000000000cc';
const OTHER = '00000000-0000-4000-8000-0000000000dd';
const ROLE = '00000000-0000-4000-8000-000000000c01';
const APPLICATION = '00000000-0000-4000-8000-000000000c02';
const OLD_APPLICATION = '00000000-0000-4000-8000-000000000c03';
const THEIR_ROLE = '00000000-0000-4000-8000-000000000c04';
const MESSAGE = '00000000-0000-4000-8000-000000000c08';
const THEIR_MESSAGE = '00000000-0000-4000-8000-000000000c09';
const ACCOUNT = '00000000-0000-4000-8000-000000000c0a';
const GMAIL_ID = 'abc123';
const MAIL_REF = `${ACCOUNT}:${GMAIL_ID}`;
const FIRST_ROUND = '00000000-0000-4000-8000-000000000c05';
const LEAD = '00000000-0000-4000-8000-000000000c0b';

let tables: FakeTables;
let seen: Set<string>;

function context(enabled: AskContext['enabledModules'] = ['jobs']): DashWriteContext {
  const client = fakeSchemaDb(tables);
  return {
    userId: ME,
    today: '2026-10-03',
    timezone: 'Europe/London',
    enabledModules: enabled,
    db: async (schema) => client(schema),
    searchSources: [],
    seen: (table, ref) => seen.has(`${table}:${ref}`),
    goals: async () => client('goals') as unknown as GoalsSupabaseClient,
    createTask: async () => ({ id: null, error: 'unused' }),
  };
}

function apply(input: unknown, ctx = context()): Promise<DashWriteResult> {
  return INTERVIEW_WRITE_TOOLS[0].apply(ctx, input);
}

function ok(result: DashWriteResult): Extract<DashWriteResult, { ok: true }> {
  if (!result.ok) throw new Error(result.error);
  return result;
}

/** Keeps the write as Ask does, then presses its Undo. */
async function keep(result: Extract<DashWriteResult, { ok: true }>) {
  const client = fakeSchemaDb(tables);
  const kept = await insertMadeChange(client('core') as unknown as CoreSupabaseClient, ME, 'conv-1', {
    ...result,
    undo: result.undo ?? null,
  } as unknown as MadeDashChange);
  const deps: ChangeDeps = {
    userId: ME,
    timezone: 'UTC',
    today: '2026-10-03',
    enabledModules: ['jobs'],
    core: client('core'),
    db: async (schema) => client(schema),
    goals: async () => client('goals') as unknown as GoalsSupabaseClient,
    createTask: async () => ({ id: null, error: 'unused' }),
    now: () => '2026-10-03T12:00:00Z',
  };
  return { kept, undo: () => undoChange(deps, kept.id) };
}

const rounds = () => tables['job_search.interview_groups'];
const interviews = () => tables['job_search.interviews'];

beforeEach(() => {
  seen = new Set();
  prepareRound.mockReset();
  recordSessionSpend.mockClear();
  process.env.ANTHROPIC_API_KEY = 'test-key';
  tables = {
    'core.dash_actions': [],
    'core.conversation_turns': [],
    'job_search.roles': [
      { id: ROLE, user_id: ME, title: 'Product designer' },
      { id: THEIR_ROLE, user_id: OTHER, title: 'Not theirs' },
    ],
    'job_search.applications': [
      { id: OLD_APPLICATION, user_id: ME, role_id: ROLE, attempt: 1 },
      { id: APPLICATION, user_id: ME, role_id: ROLE, attempt: 2 },
      { id: '00000000-0000-4000-8000-000000000c06', user_id: OTHER, role_id: THEIR_ROLE, attempt: 1 },
    ],
    'job_search.interview_groups': [
      { id: FIRST_ROUND, user_id: ME, application_id: APPLICATION, label: null, notes: null, round_number: 1 },
    ],
    'job_search.interviews': [],
    'job_search.interview_group_messages': [],
    'job_search.inbox_messages': [
      { id: MESSAGE, user_id: ME, email_account_id: ACCOUNT, provider_message_id: GMAIL_ID },
      { id: THEIR_MESSAGE, user_id: OTHER, email_account_id: ACCOUNT, provider_message_id: 'abc999' },
    ],
  };
});

describe('add_interview_round', () => {
  it('is the one interview kind Ask keeps so far', () => {
    expect(INTERVIEW_WRITE_TOOLS.map((t) => t.name)).toEqual([...INTERVIEW_CHANGE_KINDS]);
  });

  it('adds a take-home round after the role’s others, with its interview and no date', async () => {
    seen.add(`job_search.roles:${ROLE}`);
    const result = ok(await apply({ role_ref: ROLE, kind: 'take_home' }));

    const round = rounds().find((r) => r.id !== FIRST_ROUND)!;
    // On the role's latest application, numbered after round 1.
    expect(round).toMatchObject({ user_id: ME, application_id: APPLICATION, label: null, round_number: 2 });
    expect(interviews()).toEqual([
      expect.objectContaining({
        user_id: ME,
        application_id: APPLICATION,
        group_id: round.id,
        round: 1,
        kind: 'take_home',
        scheduled_at: null,
        time_known: false,
      }),
    ]);
    expect(result).toMatchObject({
      kind: 'add_interview_round',
      op: 'insert',
      subjectRef: `job_search.interview_groups:${round.id}`,
      input: {
        verb: 'Added the round',
        what: 'Take-home exercise',
        rest: ' as round 2 of Product designer, with no date set',
        href: `/jobs/roles/${ROLE}`,
        where: 'Open the role',
      },
      row: { table: 'job_search.interview_groups', ref: round.id, title: 'Round 2: Take-home exercise', href: `/jobs/roles/${ROLE}` },
    });
    expect(result.summary).toBe('Dash added round 2, Take-home exercise, to Product designer, with no date set.');
  });

  it('takes an application ref, a label and a date in the person’s zone', async () => {
    seen.add(`job_search.applications:${OLD_APPLICATION}`);
    const result = ok(
      await apply({ role_ref: OLD_APPLICATION, kind: 'panel', label: 'Systems design', date: '2026-10-09', time: '14:30' }),
    );
    // The first round on that application.
    expect(rounds().at(-1)).toMatchObject({ application_id: OLD_APPLICATION, label: 'Systems design', round_number: 1 });
    // 14:30 in London in October is 13:30 UTC.
    expect(interviews()[0]).toMatchObject({ kind: 'panel', scheduled_at: '2026-10-09T13:30:00.000Z', time_known: true });
    expect(result.summary).toBe('Dash added round 1, Systems design, to Product designer, on 2026-10-09.');
  });

  it('refuses a role that is not theirs, one no lookup returned, and a kind it does not know', async () => {
    seen.add(`job_search.roles:${THEIR_ROLE}`);
    expect(await apply({ role_ref: THEIR_ROLE, kind: 'take_home' })).toEqual({
      ok: false,
      error: 'That role is not one of theirs, or it has no application to add a round to.',
    });
    const unseen = await apply({ role_ref: ROLE, kind: 'take_home' });
    expect(!unseen.ok && unseen.error).toContain('Look it up first');
    seen.add(`job_search.roles:${ROLE}`);
    const badKind = await apply({ role_ref: ROLE, kind: 'coffee' });
    expect(!badKind.ok && badKind.error).toMatch(/^kind must be one of: .*take_home/);
    expect(rounds()).toHaveLength(1);
    expect(interviews()).toEqual([]);
  });

  it('refuses while Jobs is switched off', async () => {
    seen.add(`job_search.roles:${ROLE}`);
    const result = await apply({ role_ref: ROLE, kind: 'take_home' }, context(['todo']));
    expect(!result.ok && result.error).toContain('Jobs workspace is switched off');
  });

  it('is undone while the round is still empty, which removes the round', async () => {
    seen.add(`job_search.roles:${ROLE}`);
    const result = ok(await apply({ role_ref: ROLE, kind: 'take_home' }));
    const { kept, undo } = await keep(result);
    expect(kept).toMatchObject({ status: 'done', kind: 'add_interview_round' });

    expect(await undo()).toMatchObject({ ok: true, change: { status: 'undone' } });
    // The interview goes with it by the foreign key's cascade, which this stand-in does not run.
    expect(rounds().map((r) => r.id)).toEqual([FIRST_ROUND]);
  });

  it('is not undone once its interview has been given a date', async () => {
    seen.add(`job_search.roles:${ROLE}`);
    const { undo } = await keep(ok(await apply({ role_ref: ROLE, kind: 'take_home' })));
    interviews()[0].scheduled_at = '2026-10-12T09:00:00Z';

    expect(await undo()).toMatchObject({
      ok: false,
      error: 'The interview in this round has changed since Dash added it, so undoing would lose that.',
    });
    expect(rounds()).toHaveLength(2);
  });

  it('is not undone once a second interview is in the round', async () => {
    seen.add(`job_search.roles:${ROLE}`);
    const result = ok(await apply({ role_ref: ROLE, kind: 'take_home' }));
    const { undo } = await keep(result);
    const roundId = result.subjectRef.split(':')[1];
    interviews().push({
      id: '00000000-0000-4000-8000-000000000c07',
      user_id: ME,
      application_id: APPLICATION,
      group_id: roundId,
      kind: 'technical',
      created_at: '2026-10-03T13:00:00Z',
    });

    expect(await undo()).toMatchObject({ ok: false, error: expect.stringContaining('Something has been added to it since') });
    expect(rounds()).toHaveLength(2);
  });
});

describe('link_round_email', () => {
  const link = INTERVIEW_WRITE_TOOLS.find((t) => t.name === 'link_round_email')!;
  const attach = (input: unknown, ctx = context()) => link.apply(ctx, input);
  const links = () => tables['job_search.interview_group_messages'];
  const seeAll = () => {
    seen.add(`job_search.roles:${ROLE}`);
    seen.add(`gmail:${MAIL_REF}`);
  };

  it('attaches the email to the round and undoes by removing only the link', async () => {
    seeAll();
    const result = ok(await attach({ role_ref: ROLE, round_number: 1, message_ref: MAIL_REF }));
    expect(links()).toEqual([expect.objectContaining({ user_id: ME, group_id: FIRST_ROUND, message_id: MESSAGE })]);
    expect(result).toMatchObject({ kind: 'link_round_email', op: 'insert', summary: 'Dash attached the email to round 1 of Product designer.' });

    const { undo } = await keep(result);
    expect(await undo()).toMatchObject({ ok: true, change: { status: 'undone' } });
    expect(links()).toEqual([]);
    expect(rounds()).toHaveLength(1);
    expect(tables['job_search.inbox_messages']).toHaveLength(2);
  });

  it('says so when the email is already attached, and adds nothing', async () => {
    seeAll();
    ok(await attach({ role_ref: ROLE, round_number: 1, message_ref: MAIL_REF }));
    const again = await attach({ role_ref: ROLE, round_number: 1, message_ref: MAIL_REF });
    expect(!again.ok && again.error).toContain('already attached to round 1');
    expect(links()).toHaveLength(1);
  });

  it('refuses a round that does not exist, an email no search returned, and one that is not theirs', async () => {
    seeAll();
    const noRound = await attach({ role_ref: ROLE, round_number: 5, message_ref: MAIL_REF });
    expect(!noRound.ok && noRound.error).toContain('has no round 5');
    const unseen = await attach({ role_ref: ROLE, round_number: 1, message_ref: `${ACCOUNT}:zzz` });
    expect(!unseen.ok && unseen.error).toContain('search_mail');
    seen.add(`gmail:${ACCOUNT}:abc999`);
    const theirs = await attach({ role_ref: ROLE, round_number: 1, message_ref: `${ACCOUNT}:abc999` });
    expect(!theirs.ok && theirs.error).toContain('not in their mailbox');
    seen.add(`job_search.roles:${THEIR_ROLE}`);
    const theirRole = await attach({ role_ref: THEIR_ROLE, round_number: 1, message_ref: MAIL_REF });
    expect(!theirRole.ok && theirRole.error).toContain('not one of theirs');
    expect(links()).toEqual([]);
  });
});

describe('write_prep_note', () => {
  const prep = INTERVIEW_WRITE_TOOLS.find((t) => t.name === 'write_prep_note')!;
  const ask = (input: unknown, ctx = context()) => prep.apply(ctx, input);
  const note = { roundSummary: 'A first screen with the recruiter.' } as PrepNote;
  const written = (over: Partial<PrepareRoundResult> = {}): PrepareRoundResult => ({
    note,
    error: null,
    roleId: ROLE,
    spent: true,
    spend: [{ model: 'm', inputTokens: 1, outputTokens: 1 } as never],
    ...over,
  });
  const seeRole = () => seen.add(`job_search.roles:${ROLE}`);
  beforeEach(() => {
    tables['job_search.interviews'] = [
      { id: LEAD, user_id: ME, group_id: FIRST_ROUND, application_id: APPLICATION, kind: 'recruiter_screen', scheduled_at: null },
    ];
  });

  it('writes the note through the button’s code, says it spent a run and records the spend', async () => {
    seeRole();
    prepareRound.mockResolvedValue(written());
    const result = ok(await ask({ role_ref: ROLE, round_number: 1 }));
    expect(prepareRound).toHaveBeenCalledWith(expect.anything(), { userId: ME, interviewId: LEAD, apiKey: 'test-key' });
    expect(result).toMatchObject({
      kind: 'write_prep_note',
      op: 'update',
      subjectRef: `job_search.interviews:${LEAD}`,
      summary: 'Dash wrote the prep note for round 1 of Product designer, using one model run.',
      undo: { none: expect.any(String) },
      row: { detail: { spent_a_run: true, summary: 'A first screen with the recruiter.' } },
    });
    expect(recordSessionSpend).toHaveBeenCalledWith(ME, { module: 'jobs', operation: 'write-interview-prep' }, expect.any(Array));
  });

  it('returns an unchanged round’s stored note and says no run was spent', async () => {
    seeRole();
    prepareRound.mockResolvedValue(written({ spent: false, spend: [] }));
    const result = ok(await ask({ role_ref: ROLE, round_number: 1 }));
    expect(result.summary).toContain('already up to date, so no model run was used');
    expect(result.row?.detail).toMatchObject({ spent_a_run: false });
    expect(prepareRound).toHaveBeenCalledTimes(1);
    expect(prepareRound.mock.calls[0][1]).not.toHaveProperty('regenerate');
  });

  it('passes the refusal on in plain words, and still records any spend', async () => {
    seeRole();
    prepareRound.mockResolvedValue(
      written({ note: null, spent: false, spend: [], error: 'There is nothing to ground a prep note on.' }),
    );
    const refused = await ask({ role_ref: ROLE, round_number: 1 });
    expect(!refused.ok && refused.error).toContain('No prep note was written for round 1 of Product designer: There is nothing to ground');
    expect(interviews()[0]).not.toHaveProperty('prep_note');
  });

  it('refuses a role or round that is not theirs, an empty round, and a missing key, before any run', async () => {
    seeRole();
    const noRound = await ask({ role_ref: ROLE, round_number: 4 });
    expect(!noRound.ok && noRound.error).toContain('has no round 4');
    seen.add(`job_search.roles:${THEIR_ROLE}`);
    const theirs = await ask({ role_ref: THEIR_ROLE, round_number: 1 });
    expect(!theirs.ok && theirs.error).toContain('not one of theirs');
    const unseen = await ask({ role_ref: '00000000-0000-4000-8000-000000000fff', round_number: 1 });
    expect(!unseen.ok && unseen.error).toContain('Look it up first');
    const bad = await ask({ role_ref: ROLE, round_number: 0 });
    expect(!bad.ok && bad.error).toContain('round_number');
    tables['job_search.interviews'] = [];
    const empty = await ask({ role_ref: ROLE, round_number: 1 });
    expect(!empty.ok && empty.error).toContain('nothing to prepare for');
    tables['job_search.interviews'] = [{ id: LEAD, user_id: ME, group_id: FIRST_ROUND }];
    delete process.env.ANTHROPIC_API_KEY;
    const keyless = await ask({ role_ref: ROLE, round_number: 1 });
    expect(!keyless.ok && keyless.error).toContain('not configured');
    expect(prepareRound).not.toHaveBeenCalled();
  });

  it('refuses while Jobs is switched off, and is described as asked-for only, with no Undo', async () => {
    const off = await ask({ role_ref: ROLE, round_number: 1 }, context([]));
    expect(!off.ok && off.error).toContain('switched off');
    expect(prep.definition.description).toContain('only when they ask for the prep');
    expect(prep.definition.description).toContain('never call it as a side effect of adding a round');
    expect(prep.definition.description).toContain('with no Undo');
    expect(prep.definition.description).not.toContain('with an Undo');
  });
});
