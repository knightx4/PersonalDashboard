/**
 * What the mail sync files in the job search is recorded as Dash's (plan
 * #1575, feature #1456): every company, role, event, interview and contact
 * the job linker adds or changes leaves one scheduled record Home lists with
 * an Undo. The linker runs inside the inbox sync, which the inbox-incremental
 * cron and the daily cron's inbox stage both start (inngest/cron/inbox.ts).
 *
 * Driven through linkEnvelopes over the in-memory tables of
 * tests/stubs/fake-schema-db.ts, with the classifier, the model, the link
 * decision and Gmail stubbed so each test picks the path one email takes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SchemaClient } from '@/lib/ask/db';
import { undoDashAction } from '@/lib/core/dash-actions';
import type { LinkDecision } from '@/lib/jobs/email/link';
import type { InviteInterview } from '@/lib/jobs/calendar/invite';
import { fakeDashDeps, fakeSchemaDb, type FakeTables } from '@/tests/stubs/fake-schema-db';

type Row = Record<string, unknown>;

const stub = vi.hoisted(() => ({
  classification: 'application_confirmation' as string,
  tierA: { ats: 'unknown', companyHint: null as string | null },
  extracted: {} as Record<string, unknown>,
  decision: null as unknown,
  message: {} as Record<string, unknown>,
  invite: null as unknown,
}));

vi.mock('@/lib/email/providers/gmail', () => ({
  gmailProvider: { getMessage: vi.fn(async () => ({ ...stub.message })) },
}));
vi.mock('@/lib/jobs/email/classify', async (actual) => ({
  ...(await actual<typeof import('@/lib/jobs/email/classify')>()),
  classifyMessage: vi.fn(() => ({
    classification: stub.classification,
    ats: stub.tierA.ats,
    company: null,
    companyHint: stub.tierA.companyHint,
    scheduling: false,
    tier: 'subject_heuristic',
  })),
}));
vi.mock('@/lib/jobs/inbox/tier-b', () => ({
  LABEL_ENDS_INGEST: new Set(),
  reconcileClassification: vi.fn(() => stub.classification),
  triageWithModels: vi.fn(async () => ({
    extracted: {
      classification: stub.classification,
      dates: [],
      interviewerNames: [],
      actionRequired: false,
      summary: 'From the mail',
      confidence: 0.9,
      ...stub.extracted,
    },
    parserVersion: 1,
  })),
}));
vi.mock('@/lib/jobs/email/link', () => ({ decideLink: vi.fn(() => stub.decision) }));
vi.mock('@/lib/jobs/email/extract', async (actual) => ({
  ...(await actual<typeof import('@/lib/jobs/email/extract')>()),
  verifyExtraction: vi.fn(() => ({ ok: true })),
}));
vi.mock('@/lib/jobs/calendar/ics', () => ({
  parseIcs: vi.fn(() => [{}]),
  primaryEvent: vi.fn(() => ({})),
}));
vi.mock('@/lib/jobs/calendar/invite', async (actual) => ({
  ...(await actual<typeof import('@/lib/jobs/calendar/invite')>()),
  interviewFromInvite: vi.fn(() => stub.invite),
}));

const { linkEnvelopes, emptyCounters } = await import('@/lib/jobs/inbox/ingest-messages');

const USER = '11111111-1111-4111-8111-111111111111';
const COMPANY = 'c0000000-0000-4000-8000-000000000001';
const ROLE = 'c0000000-0000-4000-8000-000000000002';
const APP = 'c0000000-0000-4000-8000-000000000003';
const LATER = '2026-10-03T09:00:00Z';

/** A service client over the fake tables, as the sync holds one. */
function serviceClient(tables: FakeTables, schema: string): SchemaClient {
  const db = fakeSchemaDb(tables);
  const make = (name: string): SchemaClient =>
    ({
      from: (table: string) => {
        const query = db(name).from(table);
        if (name !== 'job_search' || table !== 'application_events') return query;
        // The status trigger, as far as these tests need it: a rejection closes the application.
        const insert = query.insert.bind(query);
        return Object.assign(query, {
          insert: (value: Row) => {
            const app = (tables['job_search.applications'] ?? []).find((r) => r.id === value.application_id);
            if (app && value.kind === 'rejection') app.status = 'rejected';
            if (app && value.kind === 'interview_scheduled' && app.status === 'acknowledged') app.status = 'in_process';
            return insert(value);
          },
        });
      },
      schema: (other: string) => make(other),
    }) as unknown as SchemaClient;
  return make(schema);
}

function seedPursuit(tables: FakeTables, opts: { status?: string; title?: string } = {}) {
  tables['job_search.companies'] = [
    { id: COMPANY, user_id: USER, name: 'Acme', slug: 'acme', domains: ['acme.com'], created_at: '2026-09-01T00:00:00Z' },
  ];
  tables['job_search.roles'] = [
    {
      id: ROLE,
      user_id: USER,
      company_id: COMPANY,
      title: opts.title ?? 'Designer',
      created_at: '2026-09-01T00:00:00Z',
      // What the embedded select in the linker reads back.
      applications: [{ id: APP, status: opts.status ?? 'acknowledged' }],
    },
  ];
  tables['job_search.applications'] = [
    {
      id: APP,
      user_id: USER,
      role_id: ROLE,
      status: opts.status ?? 'acknowledged',
      created_at: '2026-09-01T00:00:00Z',
      roles: { company_id: COMPANY },
    },
  ];
}

const CANDIDATE = { applicationId: APP, roleId: ROLE, companyId: COMPANY, submittedAt: null };

async function sync(tables: FakeTables) {
  const supabase = serviceClient(tables, 'job_search');
  await linkEnvelopes(
    supabase as never,
    {
      userId: USER,
      accountId: 'account',
      accessToken: 'token',
      accountEmail: 'me@example.com',
      timezone: 'UTC',
      companies: [],
      candidates: [],
      excludedDomains: [],
      counters: emptyCounters(),
    },
    [
      {
        id: 'e0000000-0000-4000-8000-000000000001',
        providerMessageId: 'gmail-1',
        threadId: 'thread-1',
        receivedAt: '2026-10-03T07:00:00Z',
        fromAddress: (stub.message.fromAddress as string) ?? 'no-reply@acme.com',
        replyToAddress: null,
        subject: 'About your application',
        isNew: true,
      },
    ],
  );
}

function records(tables: FakeTables): Row[] {
  return tables['core.dash_actions'] ?? [];
}

function invite(overrides: Partial<InviteInterview> = {}): InviteInterview {
  return {
    icsUid: 'uid-1',
    icsSequence: 1,
    scheduledAt: '2026-10-08T14:00:00Z',
    durationMinutes: 45,
    format: 'video',
    meetingUrl: null,
    location: null,
    timeZone: null,
    cancelled: false,
    interviewerNames: [],
    interviewerEmails: [],
    kind: null,
    ...overrides,
  };
}

beforeEach(() => {
  stub.classification = 'application_confirmation';
  stub.tierA = { ats: 'unknown', companyHint: null };
  stub.extracted = {};
  stub.message = {
    id: 'gmail-1',
    text: 'Thank you for applying.',
    fromAddress: 'no-reply@acme.com',
    internalDate: new Date('2026-10-03T07:00:00Z'),
  };
  stub.invite = null;
});

describe('the mail sync in the job search', () => {
  it('records a new company with the role and application the email made as one change, undone together', async () => {
    const tables: FakeTables = {};
    stub.extracted = { roleTitle: 'Designer' };
    stub.decision = {
      action: 'create_inferred_application',
      company: { kind: 'new', name: 'Acme', domain: 'acme.com' },
      confidence: 0.9,
      reasons: [],
    } satisfies LinkDecision;

    await sync(tables);

    expect(tables['job_search.roles']).toHaveLength(1);
    expect(tables['job_search.application_events']?.length).toBeGreaterThanOrEqual(1);
    const kept = records(tables);
    expect(kept).toHaveLength(1);
    const company = tables['job_search.companies'][0];
    expect(kept[0]).toMatchObject({
      surface: 'scheduled',
      kind: 'add_company',
      op: 'insert',
      subject_ref: `job_search.companies:${company.id}`,
    });
    expect(kept[0].summary).toBe(
      'Dash added Acme and the role Designer to your job search, from a confirmation email.',
    );

    const undone = await undoDashAction(fakeDashDeps(tables, USER), kept[0].id as string);
    expect(undone.ok).toBe(true);
    expect(tables['job_search.companies']).toHaveLength(0);
  });

  it('refuses to put a new role back once later mail has filed an event on it', async () => {
    const tables: FakeTables = {};
    seedPursuit(tables);
    tables['job_search.roles'][0].applications = [];
    stub.classification = 'recruiter_outreach';
    stub.extracted = { roleTitle: 'Engineer' };
    stub.message = { ...stub.message, fromAddress: 'Jane Doe <jane@acme.com>' };
    stub.decision = {
      action: 'create_lead',
      company: { kind: 'existing', id: COMPANY, name: 'Acme' },
      reasons: [],
    } satisfies LinkDecision;

    await sync(tables);

    const role = tables['job_search.roles'].find((r) => r.title === 'Engineer')!;
    const kinds = records(tables).map((r) => r.kind);
    // The role, with its application and the email's event; and the sender, who is not cascaded with it.
    expect(kinds.sort()).toEqual(['add_contact', 'add_role']);
    const added = records(tables).find((r) => r.kind === 'add_role')!;
    expect(added.subject_ref).toBe(`job_search.roles:${role.id}`);
    expect(added.summary).toBe('Dash added Engineer at Acme to your job search as a lead, from a recruiter’s email.');
    const contact = records(tables).find((r) => r.kind === 'add_contact')!;
    // The fake cannot join the new application to its company, so no "at Acme" here.
    expect(contact.summary).toBe('Dash added Jane Doe to your contacts, from an email they sent.');

    const application = tables['job_search.applications'].find((r) => r.role_id === role.id)!;
    tables['job_search.application_events'].push({
      id: 'later-event',
      user_id: USER,
      application_id: application.id,
      kind: 'recruiter_reply',
      created_at: LATER,
    });
    const refused = await undoDashAction(fakeDashDeps(tables, USER), added.id as string);
    expect(refused).toMatchObject({ ok: false, error: 'Something has been added to it since, so undoing would lose that too.' });
  });

  it('records an event filed on a pursuit already there, with the status it moved, and undoes it', async () => {
    const tables: FakeTables = {};
    seedPursuit(tables, { status: 'in_process' });
    stub.classification = 'rejection';
    stub.decision = { action: 'link', candidate: CANDIDATE, confidence: 0.95, method: 'thread', reasons: [] } as unknown as LinkDecision;

    await sync(tables);

    const kept = records(tables);
    expect(kept).toHaveLength(1);
    const event = tables['job_search.application_events'][0];
    expect(kept[0]).toMatchObject({ kind: 'file_job_email', subject_ref: `job_search.application_events:${event.id}` });
    expect(kept[0].summary).toBe('Dash filed a rejection email on Designer at Acme, which moved it from In process to Rejected.');

    const undone = await undoDashAction(fakeDashDeps(tables, USER), kept[0].id as string);
    expect(undone.ok).toBe(true);
    expect(tables['job_search.application_events']).toHaveLength(0);
  });

  it('records a round the email booked as one change, refused once the person writes on the interview', async () => {
    const tables: FakeTables = {};
    seedPursuit(tables);
    stub.classification = 'interview_invite';
    stub.extracted = {
      interviewKind: 'recruiter_screen',
      dates: [{ kind: 'interview', at: '2026-10-08T14:00:00Z' }],
      interviewerNames: ['Bob Smith'],
    };
    stub.decision = { action: 'link', candidate: CANDIDATE, confidence: 0.95, method: 'thread', reasons: [] } as unknown as LinkDecision;

    await sync(tables);

    const group = tables['job_search.interview_groups'][0];
    const interview = tables['job_search.interviews'][0];
    const byKind = Object.fromEntries(records(tables).map((r) => [r.kind, r]));
    expect(Object.keys(byKind).sort()).toEqual(['add_contact', 'book_interview', 'file_job_email']);
    expect(byKind.book_interview.subject_ref).toBe(`job_search.interview_groups:${group.id}`);
    expect(byKind.book_interview.summary).toBe(
      'Dash added a recruiter screen for Designer at Acme on Thu 8 Oct, 2:00 PM, from an interview invitation.',
    );
    expect(byKind.add_contact.summary).toBe(
      'Dash added Bob Smith at Acme to your contacts, as an interviewer for Designer at Acme.',
    );
    // The panel the email named goes with the round, not a record each.
    expect(tables['job_search.interview_participants']).toHaveLength(1);

    tables['job_search.notes'] = [{ id: 'note', user_id: USER, interview_id: interview.id, created_at: LATER }];
    const refused = await undoDashAction(fakeDashDeps(tables, USER), byKind.book_interview.id as string);
    expect(refused.ok).toBe(false);

    tables['job_search.notes'] = [];
    const undone = await undoDashAction(fakeDashDeps(tables, USER), byKind.book_interview.id as string);
    expect(undone.ok).toBe(true);
    expect(tables['job_search.interview_groups']).toHaveLength(0);
  });

  it('records an invite that moved a booked interview, with its old time to put back, and nothing for a redelivery', async () => {
    const tables: FakeTables = {};
    seedPursuit(tables, { status: 'in_process' });
    tables['job_search.interviews'] = [
      {
        id: 'interview-1',
        user_id: USER,
        application_id: APP,
        ics_uid: 'uid-1',
        ics_sequence: 0,
        scheduled_at: '2026-10-07T10:00:00Z',
        status: 'scheduled',
        updated_at: '2026-09-30T00:00:00Z',
      },
    ];
    tables['job_search.contacts'] = [
      { id: 'jane', user_id: USER, company_id: COMPANY, full_name: 'Jane Doe', email: 'jane@acme.com' },
    ];
    stub.classification = 'scheduling';
    stub.message = { ...stub.message, calendar: ['BEGIN:VCALENDAR'] };
    stub.invite = invite({ interviewerNames: ['Jane Doe'], interviewerEmails: ['jane@acme.com'] });
    stub.decision = { action: 'link', candidate: CANDIDATE, confidence: 0.95, method: 'thread', reasons: [] } as unknown as LinkDecision;

    await sync(tables);

    const byKind = Object.fromEntries(records(tables).map((r) => [r.kind, r]));
    expect(Object.keys(byKind).sort()).toEqual(['add_interviewer', 'file_job_email', 'update_interview']);
    expect(byKind.update_interview.summary).toBe(
      'Dash moved your interview for Designer at Acme from Wed 7 Oct, 10:00 AM to Thu 8 Oct, 2:00 PM, from an updated calendar invite.',
    );
    expect(byKind.add_interviewer.summary).toBe(
      'Dash put Jane Doe on your interview for Designer at Acme on Thu 8 Oct, 2:00 PM, from a scheduling email.',
    );

    const undone = await undoDashAction(fakeDashDeps(tables, USER), byKind.update_interview.id as string);
    expect(undone.ok).toBe(true);
    expect(tables['job_search.interviews'][0].scheduled_at).toBe('2026-10-07T10:00:00Z');

    // The same invite again, onto the row it already describes.
    tables['core.dash_actions'] = [];
    tables['job_search.ingested_messages'] = [];
    Object.assign(tables['job_search.interviews'][0], { scheduled_at: '2026-10-08T14:00:00Z', ics_sequence: 1 });
    await sync(tables);
    expect(records(tables).map((r) => r.kind)).toEqual(['file_job_email']);
  });

  it('records what the email taught a known company and role, each with its old values', async () => {
    const tables: FakeTables = {};
    seedPursuit(tables, { title: 'Role from email' });
    tables['job_search.contacts'] = [
      { id: 'jane', user_id: USER, company_id: COMPANY, full_name: 'Jane Doe', email: null },
    ];
    stub.classification = 'recruiter_reply';
    stub.tierA = { ats: 'greenhouse', companyHint: 'acme' };
    stub.extracted = { roleTitle: 'Designer' };
    stub.message = { ...stub.message, fromAddress: 'Jane Doe <jane@acmecorp.com>' };
    stub.decision = {
      action: 'create_inferred_application',
      company: { kind: 'existing', id: COMPANY, name: 'Acme', domainToLearn: 'acmecorp.com' },
      confidence: 0.9,
      reasons: [],
    } as unknown as LinkDecision;

    await sync(tables);

    const byKind = Object.fromEntries(records(tables).map((r) => [r.kind, r]));
    expect(Object.keys(byKind).sort()).toEqual([
      'file_job_email',
      'fill_contact_email',
      'learn_company_domain',
      'learn_job_board',
      'name_role',
    ]);
    expect(byKind.learn_company_domain.summary).toBe(
      'Dash noted that mail from acmecorp.com is from Acme, so later mail from there files under it.',
    );
    expect(byKind.learn_job_board.summary).toBe(
      'Dash noted that Acme probably posts its jobs on the Greenhouse board “acme”, so their descriptions can be looked up.',
    );
    expect(byKind.name_role.summary).toBe(
      'Dash named the role Designer at Acme, which was called “Role from email”, from a reply from a recruiter.',
    );
    expect(byKind.fill_contact_email.summary).toBe(
      'Dash added jane@acmecorp.com to Jane Doe’s contact details, from an email they sent.',
    );

    const renamed = await undoDashAction(fakeDashDeps(tables, USER), byKind.name_role.id as string);
    expect(renamed.ok).toBe(true);
    expect(tables['job_search.roles'][0].title).toBe('Role from email');
    const filled = await undoDashAction(fakeDashDeps(tables, USER), byKind.fill_contact_email.id as string);
    expect(filled.ok).toBe(true);
    expect(tables['job_search.contacts'][0].email).toBeNull();
  });
});
