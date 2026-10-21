import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeId, fakeSchemaDb, type FakeTables } from '../../tests/stubs/fake-schema-db';
import { JOBS_WRITES, runJobsWrite, undoRoleMerge, type JobsWriteEnv } from './jobs-writes';
import type { DashWriteContext } from './registry';
import { WRITE_TOOLS } from './writes';

/**
 * Each Jobs tool writes the same rows as the button it matches, for the same
 * input (plan #2473.2). Both run against one in-memory database seeded the
 * same way: the button through its server action, signed in as ME, the tool
 * through runJobsWrite. Then every table either touched is compared, leaving
 * out only the clock and the ids a new row is given.
 */

const ME = '00000000-0000-4000-8000-0000000000aa';

const session = vi.hoisted(() => ({ tables: {} as Record<string, Record<string, unknown>[]> }));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn() }));
vi.mock('@/lib/jobs/auth/server', async () => {
  const { fakeSchemaDb: fake } = await import('../../tests/stubs/fake-schema-db');
  return {
    requireUser: async () => ({ id: '00000000-0000-4000-8000-0000000000aa' }),
    getUser: async () => ({ id: '00000000-0000-4000-8000-0000000000aa' }),
    createClient: async () => fake(session.tables)('job_search'),
  };
});
vi.mock('@/lib/core/account/settings', () => ({ loadAccountSettings: async () => ({ timezone: 'UTC' }) }));
vi.mock('@/lib/core/auth/server', async () => {
  const { fakeSchemaDb: fake } = await import('../../tests/stubs/fake-schema-db');
  return {
    requireUser: async () => ({ id: '00000000-0000-4000-8000-0000000000aa' }),
    createCoreClient: async () => fake(session.tables)('core'),
    createClient: async () => fake(session.tables)('core'),
  };
});

const VOLATILE = new Set(['created_at', 'updated_at', 'requirements_extracted_at', 'sent_at', 'responded_at', 'acted_at', 'perspective_updated_at', 'canonical_answer_updated_at', 'occurred_at', 'completed_at', 'acknowledged_at']);

/** Every table, its rows with each time only set or not, sorted so order does not count. */
function settled(tables: FakeTables, newIds: Set<string>): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const [name, rows] of Object.entries(tables)) {
    out[name] = rows
      .map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([key, value]) => [
            key,
            VOLATILE.has(key) ? (value == null ? null : '<time>') : typeof value === 'string' && newIds.has(value) ? '<new>' : value,
          ]),
        ),
      )
      .map((row) => JSON.stringify(Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b)))))
      .sort();
  }
  return out;
}

function idsIn(tables: FakeTables): Set<string> {
  return new Set(Object.values(tables).flatMap((rows) => rows.map((row) => row.id as string)));
}

/**
 * The tables after the button and after the tool, each run on a fresh copy
 * of `seed`.
 */
async function bothWays(
  seed: () => FakeTables,
  button: () => Promise<unknown>,
  tool: string,
  args: Record<string, unknown>,
): Promise<{ byButton: Record<string, unknown[]>; byTool: Record<string, unknown[]> }> {
  session.tables = seed();
  const before = idsIn(session.tables);
  const pressed = (await button()) as { error?: string | null } | undefined;
  if (pressed && typeof pressed === 'object' && pressed.error) throw new Error(`the button failed: ${pressed.error}`);
  const buttonNew = new Set([...idsIn(session.tables)].filter((id) => !before.has(id)));
  const byButton = settled(session.tables, buttonNew);

  const tables = seed();
  const db = fakeSchemaDb(tables);
  const env: JobsWriteEnv = { userId: ME, jobs: db('job_search'), todo: db('todo'), core: db('core') };
  const write = JOBS_WRITES.find((entry) => entry.name === tool);
  if (write) {
    const result = await runJobsWrite(write, env, args);
    if ('ok' in result) throw new Error(`the tool refused: ${result.error}`);
  } else {
    // A Jobs tool kept with the other write tools, run as Ask runs it, every ref counted as looked up.
    const other = WRITE_TOOLS.find((entry) => entry.name === tool);
    if (!other) throw new Error(`no Jobs tool ${tool}`);
    const ctx = {
      userId: ME,
      today: '2026-10-08',
      timezone: 'UTC',
      enabledModules: ['jobs'],
      db: async (schema: string) => db(schema),
      searchSources: [],
      seen: Object.assign(() => true, { sets: new Map() }),
      goals: async () => db('goals'),
      createTask: async () => ({ id: null, error: 'unused' }),
    } as unknown as DashWriteContext;
    const result = await other.apply(ctx, args);
    if (!result.ok) throw new Error(`the tool refused: ${result.error}`);
  }
  const toolNew = new Set([...idsIn(tables)].filter((id) => !before.has(id)));
  return { byButton, byTool: settled(tables, toolNew) };
}

const ROLE = '11111111-1111-4111-8111-111111111111';
const COMPANY = '22222222-2222-4222-8222-222222222222';

function roleSeed(): FakeTables {
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
        seniority: null,
        posting_status: 'unknown',
        jd_url: null,
        jd_text: null,
        comp_min_cents: null,
        comp_max_cents: null,
        comp_source: null,
      },
    ],
  };
}

/** The fact origins differ by who made the change: the page records the person, Dash itself. */
function withoutOrigins(tables: Record<string, unknown[]>): Record<string, unknown[]> {
  const rest = { ...tables };
  delete rest['job_search.fact_origins'];
  return rest;
}

describe('change_role writes the role as its buttons do', () => {
  beforeEach(() => {
    session.tables = {};
  });

  it('renames it as the rename does', async () => {
    const { renameRole } = await import('@/app/jobs/(app)/roles/[id]/actions');
    const { byButton, byTool } = await bothWays(roleSeed, () => renameRole(ROLE, 'Data Engineer'), 'change_role', {
      role_ref: ROLE,
      title: 'Data Engineer',
    });
    expect(byTool).toEqual(byButton);
  });

  it('moves it under a company not on file, making it, as the move does', async () => {
    const { moveRoleToCompany } = await import('@/app/jobs/(app)/roles/[id]/actions');
    const { byButton, byTool } = await bothWays(roleSeed, () => moveRoleToCompany(ROLE, 'Globex'), 'change_role', {
      role_ref: ROLE,
      company: 'Globex',
    });
    expect(byTool).toEqual(byButton);
  });

  it('saves a pasted description, its band and the other fields as the edit does', async () => {
    const { updateRole } = await import('@/app/jobs/(app)/roles/actions');
    const description = 'We build data tools.\nThe salary range for this role is $150,000 - $180,000 per year.';
    const { byButton, byTool } = await bothWays(
      roleSeed,
      () => updateRole(ROLE, { jdText: description, location: 'London', workMode: 'remote', seniority: 'Staff', jdUrl: 'https://acme.example/jobs/1' }),
      'change_role',
      { role_ref: ROLE, description, location: 'London', work_mode: 'remote', seniority: 'Staff', posting_url: 'https://acme.example/jobs/1', fact_source: 'person' },
    );
    expect(withoutOrigins(byTool)).toEqual(withoutOrigins(byButton));
  });
});

const APP = '33333333-3333-4333-8333-333333333333';
const CONTACT = '55555555-5555-4555-8555-555555555555';

function applicationSeed(): FakeTables {
  return {
    ...roleSeed(),
    'job_search.applications': [
      {
        id: APP,
        user_id: ME,
        role_id: ROLE,
        attempt: 1,
        excitement: null,
        source: 'portal',
        referral_contact_id: null,
        ready_to_apply: false,
        all_questions_added: false,
        has_cover_letter: null,
      },
    ],
    'job_search.contacts': [{ id: CONTACT, user_id: ME, name: 'Sam' }],
  };
}

describe('change_application writes the application as its buttons do', () => {
  it('sets excitement as the picker does', async () => {
    const { setExcitement } = await import('@/app/jobs/(app)/pipeline/actions');
    const { byButton, byTool } = await bothWays(applicationSeed, () => setExcitement(APP, 4), 'change_application', {
      application_ref: APP,
      excitement: 4,
    });
    expect(byTool).toEqual(byButton);
  });

  it('sets a referral with who referred them as the channel picker does', async () => {
    const { setChannel } = await import('@/app/jobs/(app)/pipeline/actions');
    const { byButton, byTool } = await bothWays(applicationSeed, () => setChannel(APP, 'referral', CONTACT), 'change_application', {
      application_ref: APP,
      channel: 'referral',
      referral_contact_ref: CONTACT,
    });
    expect(byTool).toEqual(byButton);
  });

  it('saves the three marks as the role page does', async () => {
    const { saveApplicationMarks } = await import('@/app/jobs/(app)/roles/[id]/actions');
    const { byButton, byTool } = await bothWays(
      applicationSeed,
      () => saveApplicationMarks({ applicationId: APP, roleId: ROLE, readyToApply: true, allQuestionsAdded: true, hasCoverLetter: false }),
      'change_application',
      { application_ref: APP, ready_to_apply: true, all_questions_added: true, has_cover_letter: false },
    );
    expect(byTool).toEqual(byButton);
  });
});

function companySeed(): FakeTables {
  return {
    'job_search.companies': [
      { id: COMPANY, user_id: ME, name: 'Acme', slug: 'acme', domains: [], priority: 'interested', industry: null, research: null },
    ],
  };
}

describe('change_company and add_company write the company as their buttons do', () => {
  it('renames it, moving its slug, as the rename does', async () => {
    const { renameCompany } = await import('@/app/jobs/(app)/companies/actions');
    const { byButton, byTool } = await bothWays(companySeed, () => renameCompany(COMPANY, 'Acme Data'), 'change_company', {
      company_ref: COMPANY,
      name: 'Acme Data',
    });
    expect(byTool).toEqual(byButton);
  });

  it('saves its priority, industry, research and domains as the page does', async () => {
    const { updateCompany } = await import('@/app/jobs/(app)/companies/actions');
    const { byButton, byTool } = await bothWays(
      companySeed,
      () =>
        updateCompany({
          companyId: COMPANY,
          priority: 'target',
          industry: 'Data tools',
          research: 'Series B.',
          domains: 'https://www.acme.com/jobs, acme.io',
        }),
      'change_company',
      { company_ref: COMPANY, priority: 'target', industry: 'Data tools', research: 'Series B.', domains: 'https://www.acme.com/jobs, acme.io' },
    );
    expect(byTool).toEqual(byButton);
  });

  it('adds one from scratch with its website as Add company does', async () => {
    const { addCompany } = await import('@/app/jobs/(app)/companies/actions');
    const { byButton, byTool } = await bothWays(
      () => ({ 'job_search.companies': [] }),
      () => addCompany({ name: 'Globex', website: 'https://globex.example' }),
      'add_company',
      { name: 'Globex', website: 'https://globex.example' },
    );
    expect(byTool).toEqual(byButton);
  });

  it("adds a startup Find discovered as Find's Add to my companies does", async () => {
    const STARTUP = '99999999-9999-4999-8999-999999999999';
    const { addDiscoveredCompany } = await import('@/app/jobs/(app)/find/actions');
    const seed = (): FakeTables => ({
      'job_search.companies': [],
      'job_search.watchlist_startups': [
        { id: STARTUP, user_id: ME, name: 'Initech', website: 'https://initech.example', board_vendor: 'greenhouse', board_token: 'initech', company_id: null },
      ],
    });
    const { byButton, byTool } = await bothWays(seed, () => addDiscoveredCompany(STARTUP), 'add_discovered_company', { startup_ref: STARTUP });
    expect(byTool).toEqual(byButton);
  });
});

const TOUCH = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SUGGESTION = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';

function peopleSeed(): FakeTables {
  return {
    ...companySeed(),
    'job_search.contacts': [
      { id: CONTACT, user_id: ME, full_name: 'Sam Lee', title: null, email: null, company_id: COMPANY, status: 'to_contact', relationship: 'cold' },
    ],
    'job_search.contact_touches': [
      { id: TOUCH, user_id: ME, contact_id: CONTACT, application_id: null, channel: 'linkedin_dm', direction: 'outbound', message: 'Hi', sent_at: '2026-10-01T09:00:00Z', draft: true, responded_at: null, response_summary: null },
    ],
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
    ],
  };
}

/** The same touch, already sent, for marking answered. */
function sentSeed(): FakeTables {
  const seed = peopleSeed();
  seed['job_search.contact_touches'][0].draft = false;
  return seed;
}

describe('the contact tools write the rows the contacts pages do', () => {
  it('adds a contact as the Add contact form does', async () => {
    const { createContact } = await import('@/app/jobs/(app)/contacts/actions');
    const form = new FormData();
    form.set('fullName', 'Jo Park');
    form.set('title', 'Recruiter');
    form.set('companyId', COMPANY);
    form.set('relationship', 'alum');
    form.set('linkedinUrl', 'https://www.linkedin.com/in/jo');
    form.set('notes', 'Met at the meetup.');
    const { byButton, byTool } = await bothWays(peopleSeed, () => createContact({}, form), 'change_contact', {
      full_name: 'Jo Park',
      title: 'Recruiter',
      company: 'Acme',
      relationship: 'alum',
      linkedin_url: 'https://www.linkedin.com/in/jo',
      notes: 'Met at the meetup.',
    });
    expect(byTool).toEqual(byButton);
  });

  it("corrects a contact's details as the contact page does", async () => {
    const { updateContact } = await import('@/app/jobs/(app)/contacts/actions');
    const { byButton, byTool } = await bothWays(
      peopleSeed,
      () => updateContact(CONTACT, { title: 'Head of Data', email: 'sam@acme.com', relationship: 'former_colleague' }),
      'change_contact',
      { contact_ref: CONTACT, title: 'Head of Data', email: 'sam@acme.com', relationship: 'former_colleague' },
    );
    expect(byTool).toEqual(byButton);
  });

  it('logs a send, moving the contact to contacted, as Log a send does', async () => {
    const { logTouch } = await import('@/app/jobs/(app)/contacts/actions');
    const { byButton, byTool } = await bothWays(
      peopleSeed,
      () => logTouch({ contactId: CONTACT, channel: 'email', direction: 'outbound', message: 'Coffee?' }),
      'change_touch',
      { action: 'log', contact_ref: CONTACT, channel: 'email', direction: 'outbound', message: 'Coffee?' },
    );
    expect(byTool).toEqual(byButton);
  });

  it('keeps a draft, moving nobody, as Log a send with Keep as draft does', async () => {
    const { logTouch } = await import('@/app/jobs/(app)/contacts/actions');
    const { byButton, byTool } = await bothWays(
      peopleSeed,
      () => logTouch({ contactId: CONTACT, channel: 'email', direction: 'outbound', message: 'Coffee?', draft: true }),
      'change_touch',
      { action: 'log', contact_ref: CONTACT, channel: 'email', direction: 'outbound', message: 'Coffee?', draft: true },
    );
    expect(byTool).toEqual(byButton);
  });

  it("corrects a touch's channel and words as the log does", async () => {
    const { updateTouch } = await import('@/app/jobs/(app)/contacts/actions');
    const { byButton, byTool } = await bothWays(
      peopleSeed,
      () => updateTouch(TOUCH, { channel: 'email', message: 'Hello again' }),
      'change_touch',
      { action: 'edit', touch_ref: TOUCH, channel: 'email', message: 'Hello again' },
    );
    expect(byTool).toEqual(byButton);
  });

  it('marks a draft sent, moving the contact to contacted, as Mark sent does', async () => {
    const { markTouchSent } = await import('@/app/jobs/(app)/contacts/actions');
    const { byButton, byTool } = await bothWays(peopleSeed, () => markTouchSent(TOUCH), 'change_touch', { action: 'sent', touch_ref: TOUCH });
    expect(byTool).toEqual(byButton);
    expect(byTool['job_search.contacts'][0]).toContain('"status":"contacted"');
  });

  it('marks a send answered, moving the contact to responded, as Answered does', async () => {
    const { markTouchAnswered } = await import('@/app/jobs/(app)/contacts/actions');
    const { byButton, byTool } = await bothWays(sentSeed, () => markTouchAnswered(TOUCH, 'Happy to chat'), 'change_touch', {
      action: 'answered',
      touch_ref: TOUCH,
      response: 'Happy to chat',
    });
    expect(byTool).toEqual(byButton);
  });

  it("marks a suggested person messaged as Find's Sent does", async () => {
    const { markSuggestionSent } = await import('@/app/jobs/(app)/find/recommend-actions');
    const { byButton, byTool } = await bothWays(peopleSeed, () => markSuggestionSent(SUGGESTION), 'mark_suggestion_sent', {
      suggestion_ref: SUGGESTION,
    });
    expect(byTool).toEqual(byButton);
  });
});

const QUESTION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ANSWER = '99999999-9999-4999-8999-999999999991';
const EVIDENCE = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

function answerSeed(): FakeTables {
  return {
    ...applicationSeed(),
    'job_search.questions': [
      { id: QUESTION, user_id: ME, text: 'Why do you want to work here?', fingerprint: 'why do you want to work here', canonical_answer: null, canonical_answer_updated_at: null },
    ],
    'job_search.application_answers': [
      { id: ANSWER, user_id: ME, application_id: APP, question_id: QUESTION, answer: null, status: 'draft', evidence_item_ids: [], unsupported_claims: [], considerations: [] },
    ],
    'job_search.evidence_items': [{ id: EVIDENCE, user_id: ME, used_count: 0 }],
  };
}

describe('the answer tools write the rows the role page does', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('saves an answer approved as Save does', async () => {
    const { saveAnswer } = await import('@/app/jobs/(app)/roles/actions');
    const { byButton, byTool } = await bothWays(answerSeed, () => saveAnswer(ANSWER, 'Because of the data tools.', 'approved'), 'save_answer', {
      answer_ref: ANSWER,
      answer: 'Because of the data tools.',
      status: 'approved',
    });
    expect(byTool).toEqual(byButton);
  });

  it('keeps a drafted answer with what it rests on as Keep this draft does', async () => {
    const { saveDraftedAnswer } = await import('@/app/jobs/(app)/roles/actions');
    const { byButton, byTool } = await bothWays(
      answerSeed,
      () =>
        saveDraftedAnswer({
          answerId: ANSWER,
          answer: 'Because of the data tools.',
          evidenceItemIds: [EVIDENCE],
          unsupportedClaims: ['Led a team of ten'],
          considerations: ['Name the product'],
        }),
      'save_answer',
      {
        answer_ref: ANSWER,
        answer: 'Because of the data tools.',
        status: 'draft',
        evidence_refs: [EVIDENCE],
        unsupported_claims: ['Led a team of ten'],
        considerations: ['Name the product'],
      },
    );
    expect(byTool).toEqual(byButton);
  });

  it('makes an answer the default as Make this my default answer does', async () => {
    const { promoteToCanonical } = await import('@/app/jobs/(app)/roles/actions');
    const { byButton, byTool } = await bothWays(answerSeed, () => promoteToCanonical(QUESTION, 'Because of the data tools.'), 'set_default_answer', {
      question_ref: QUESTION,
      answer: 'Because of the data tools.',
    });
    expect(byTool).toEqual(byButton);
  });
});

describe('move_roles moves an application as the board does', () => {
  it('writes the stage move event and the override', async () => {
    const { moveApplication } = await import('@/app/jobs/(app)/pipeline/actions');
    const seed = (): FakeTables => {
      const tables = applicationSeed();
      Object.assign(tables['job_search.applications'][0], { status: 'lead', status_manual_override: null });
      tables['job_search.application_events'] = [];
      return tables;
    };
    const { byButton, byTool } = await bothWays(seed, () => moveApplication(APP, 'in_process'), 'move_roles', {
      stage: 'in_process',
      application_refs: [APP],
    });
    // The event says who moved it: the person by hand, or Dash.
    const by = (rows: unknown[]) => rows.map((row) => String(row).replace(/by (hand|Dash)/g, 'by <who>'));
    expect(by(byTool['job_search.application_events'])).toEqual(by(byButton['job_search.application_events']));
    expect(byTool['job_search.applications']).toEqual(byButton['job_search.applications']);
    expect(byButton['job_search.application_events']).toHaveLength(1);
  });
});

const REMINDER = 'ffffffff-ffff-4fff-8fff-fffffffffff1';
const MAIL = 'ffffffff-ffff-4fff-8fff-fffffffffff2';
const WAITING_EVENT = 'ffffffff-ffff-4fff-8fff-fffffffffff3';

function todaySeed(): FakeTables {
  return {
    ...applicationSeed(),
    'job_search.reminders': [
      { id: REMINDER, user_id: ME, application_id: APP, body: 'Send the take-home', due_at: '2026-10-01T00:00:00.000Z', completed_at: null, ingested_message_id: null, rule_key: null },
    ],
    'job_search.inbox_messages': [{ id: MAIL, user_id: ME, subject: 'Your take-home' }],
    'job_search.application_events': [
      { id: WAITING_EVENT, user_id: ME, application_id: APP, kind: 'email_received', summary: 'Pick a time', payload: { action_required: true } },
    ],
    'job_search.waiting_dismissals': [],
  };
}

describe('change_reminder and change_waiting write the rows Jobs Today and the timeline do', () => {
  it('finishes a reminder as Done does', async () => {
    const { completeReminder } = await import('@/app/jobs/(app)/_home/actions');
    const { byButton, byTool } = await bothWays(todaySeed, () => completeReminder(REMINDER), 'change_reminder', { reminder_ref: REMINDER, finish: true });
    expect(byTool).toEqual(byButton);
  });

  it('puts a reminder off to the same day as Later does', async () => {
    const { snoozeReminder } = await import('@/app/jobs/(app)/_home/actions');
    const { byButton, byTool } = await bothWays(todaySeed, () => snoozeReminder(REMINDER, '2027-01-04'), 'change_reminder', {
      reminder_ref: REMINDER,
      put_off: '2027-01-04',
    });
    expect(byTool).toEqual(byButton);
    expect(JSON.stringify(byTool['job_search.reminders'])).toContain('2027-01-04');
  });

  it('rewords and moves a reminder as the timeline edit does', async () => {
    const { updateReminder } = await import('@/app/jobs/(app)/roles/[id]/timeline-actions');
    const { byButton, byTool } = await bothWays(
      todaySeed,
      () => updateReminder({ reminderId: REMINDER, body: 'Send the take-home by Friday', dueAt: '2026-10-09' }),
      'change_reminder',
      { reminder_ref: REMINDER, body: 'Send the take-home by Friday', due: '2026-10-09' },
    );
    expect(byTool).toEqual(byButton);
  });

  it("links a reminder to its email as the timeline's picker does", async () => {
    const { linkReminderMessage } = await import('@/app/jobs/(app)/roles/[id]/timeline-actions');
    const { byButton, byTool } = await bothWays(todaySeed, () => linkReminderMessage({ reminderId: REMINDER, messageId: MAIL }), 'change_reminder', {
      reminder_ref: REMINDER,
      email_ref: MAIL,
    });
    expect(byTool).toEqual(byButton);
  });

  it('marks a waiting row done as Done does', async () => {
    const { completeWaiting } = await import('@/app/jobs/(app)/_home/actions');
    const { byButton, byTool } = await bothWays(todaySeed, () => completeWaiting(WAITING_EVENT), 'change_waiting', {
      verb: 'finish',
      event_ref: WAITING_EVENT,
    });
    expect(byTool).toEqual(byButton);
    expect(byTool['job_search.waiting_dismissals']).toHaveLength(1);
  });

  it('puts a waiting row off as Later does', async () => {
    const { snoozeWaiting } = await import('@/app/jobs/(app)/_home/actions');
    const { byButton, byTool } = await bothWays(todaySeed, () => snoozeWaiting(WAITING_EVENT, '2027-01-04'), 'change_waiting', {
      verb: 'put_off',
      event_ref: WAITING_EVENT,
      until: '2027-01-04',
    });
    expect(byTool).toEqual(byButton);
  });
});

const THOUGHT = 'ffffffff-ffff-4fff-8fff-fffffffffff4';

function materialSeed(): FakeTables {
  return {
    'job_search.evidence_items': [],
    'job_search.resume_versions': [],
    'job_search.thoughts': [{ id: THOUGHT, user_id: ME, body: 'Data platform roles in London.' }],
  };
}

describe('the career tools write the rows Material and Settings do', () => {
  it('adds a story to the evidence bank as the Material form does', async () => {
    const { addEvidence } = await import('@/app/jobs/(app)/material/evidence-actions');
    const form = new FormData();
    form.set('title', 'Cut the warehouse bill');
    form.set('body', 'I moved the nightly jobs to incremental loads.');
    form.set('context', 'Acme, 2024');
    form.set('metrics', '40% cheaper');
    form.set('skills', 'Data Modelling, sql, SQL');
    form.set('strength', '4');
    const { byButton, byTool } = await bothWays(materialSeed, () => addEvidence({}, form), 'add_evidence', {
      title: 'Cut the warehouse bill',
      body: 'I moved the nightly jobs to incremental loads.',
      context: 'Acme, 2024',
      metrics: '40% cheaper',
      skills: ['Data Modelling', 'sql', 'SQL'],
      strength: 4,
    });
    expect(byTool).toEqual(byButton);
  });

  it('adds a resume version from its text as the Material form does', async () => {
    const { addResumeVersion } = await import('@/app/jobs/(app)/material/evidence-actions');
    const form = new FormData();
    form.set('label', 'Data engineering, Oct 2026');
    form.set('notes', 'For platform roles');
    form.set('textContent', 'Selvey Knight. Data engineer.');
    const { byButton, byTool } = await bothWays(materialSeed, () => addResumeVersion({}, form), 'add_resume_version', {
      label: 'Data engineering, Oct 2026',
      notes: 'For platform roles',
      text_content: 'Selvey Knight. Data engineer.',
    });
    expect(byTool).toEqual(byButton);
  });

  it('adds a career goals entry as Settings does', async () => {
    const { addThought } = await import('@/app/jobs/(app)/settings/career-goal-actions');
    const form = new FormData();
    form.set('body', 'Staff roles only from next year.');
    const { byButton, byTool } = await bothWays(materialSeed, () => addThought({ error: null }, form), 'change_career_thought', {
      body: 'Staff roles only from next year.',
    });
    expect(byTool).toEqual(byButton);
  });

  it('rewords a career goals entry as Settings does', async () => {
    const { updateThought } = await import('@/app/jobs/(app)/settings/career-goal-actions');
    const { byButton, byTool } = await bothWays(materialSeed, () => updateThought(THOUGHT, 'Data platform roles in London or remote.'), 'change_career_thought', {
      thought_ref: THOUGHT,
      body: 'Data platform roles in London or remote.',
    });
    expect(byTool).toEqual(byButton);
  });
});

const R1 = '44444444-4444-4444-8444-444444444441';
const R2 = '44444444-4444-4444-8444-444444444442';
const I1 = '45555555-5555-4555-8555-555555555551';
const I2 = '45555555-5555-4555-8555-555555555552';
const I3 = '45555555-5555-4555-8555-555555555553';
const ROUND_MAIL = '47777777-7777-4777-8777-777777777777';
const ROUND_LINK = '48888888-8888-4888-8888-888888888888';
const ACCOUNT = '49999999-9999-4999-8999-999999999999';

function interviewSeed(): FakeTables {
  // The button reads the role's company through an embedded select, which the
  // stand-in database answers with whatever the row holds: so the row holds it.
  const via = { applications: { roles: { company_id: COMPANY } } };
  const interview = (id: string, group: string, place: number, kind: string) => ({
    id,
    user_id: ME,
    application_id: APP,
    group_id: group,
    round: place,
    kind,
    status: 'scheduled',
    scheduled_at: null,
    time_known: false,
    notes: null,
    prep_notes: null,
    ...via,
  });
  return {
    ...applicationSeed(),
    'core.account_settings': [{ user_id: ME, timezone: 'UTC' }],
    'job_search.interview_groups': [
      { id: R1, user_id: ME, application_id: APP, round_number: 1, label: null, notes: null },
      { id: R2, user_id: ME, application_id: APP, round_number: 2, label: 'Onsite', notes: null },
    ],
    'job_search.interviews': [interview(I1, R1, 1, 'recruiter_screen'), interview(I2, R2, 1, 'technical'), interview(I3, R2, 2, 'hiring_manager')],
    'job_search.interview_participants': [],
    'job_search.contacts': [{ id: CONTACT, user_id: ME, full_name: 'Priya Shah', company_id: COMPANY }],
    'job_search.interview_group_messages': [{ id: ROUND_LINK, user_id: ME, group_id: R2, message_id: ROUND_MAIL }],
    'job_search.inbox_messages': [
      { id: ROUND_MAIL, user_id: ME, email_account_id: ACCOUNT, provider_message_id: 'abc' },
      { id: MAIL, user_id: ME, email_account_id: ACCOUNT, provider_message_id: 'def' },
    ],
  };
}

describe("the interview tools write the rows the role page's round cards do", () => {
  it("corrects an interview's kind, status and notes as its card does", async () => {
    const { saveInterview } = await import('@/app/jobs/(app)/roles/[id]/interview-actions');
    const { byButton, byTool } = await bothWays(
      interviewSeed,
      () => saveInterview(I2, { kind: 'case', status: 'completed', notes: 'Went well.', prepNotes: 'Read the paper.' }),
      'change_interview',
      { interview_ref: I2, kind: 'case', status: 'completed', notes: 'Went well.', prep_notes: 'Read the paper.' },
    );
    expect(byTool).toEqual(byButton);
  });

  it('names a contact as an interviewer as the picker does', async () => {
    const { addInterviewer } = await import('@/app/jobs/(app)/roles/[id]/interview-actions');
    const { byButton, byTool } = await bothWays(interviewSeed, () => addInterviewer({ interviewId: I2, contactId: CONTACT }), 'change_interviewer', {
      action: 'add',
      interview_ref: I2,
      contact_ref: CONTACT,
    });
    expect(byTool).toEqual(byButton);
  });

  it('names someone new as an interviewer, making the contact at the company, as "add someone new" does', async () => {
    const { addInterviewerByName } = await import('@/app/jobs/(app)/roles/[id]/interview-actions');
    const { byButton, byTool } = await bothWays(interviewSeed, () => addInterviewerByName({ interviewId: I2, name: 'Sam Okafor' }), 'change_interviewer', {
      action: 'add',
      interview_ref: I2,
      name: 'Sam Okafor',
    });
    expect(byTool).toEqual(byButton);
    expect(byTool['job_search.contacts']).toHaveLength(2);
  });

  it('attaches a contact already there by name rather than making a second', async () => {
    const { addInterviewerByName } = await import('@/app/jobs/(app)/roles/[id]/interview-actions');
    const { byButton, byTool } = await bothWays(interviewSeed, () => addInterviewerByName({ interviewId: I2, name: 'priya shah' }), 'change_interviewer', {
      action: 'add',
      interview_ref: I2,
      name: 'priya shah',
    });
    expect(byTool).toEqual(byButton);
    expect(byTool['job_search.contacts']).toHaveLength(1);
  });

  it('takes an interviewer off as the round does', async () => {
    const { removeInterviewer } = await import('@/app/jobs/(app)/roles/[id]/interview-actions');
    const seed = () => {
      const tables = interviewSeed();
      tables['job_search.interview_participants'] = [{ id: 'aaaaaaaa-0000-4000-8000-000000000001', interview_id: I2, contact_id: CONTACT, role: 'interviewer' }];
      return tables;
    };
    const { byButton, byTool } = await bothWays(seed, () => removeInterviewer({ interviewId: I2, contactId: CONTACT }), 'change_interviewer', {
      action: 'remove',
      interview_ref: I2,
      contact_ref: CONTACT,
    });
    expect(byTool).toEqual(byButton);
    expect(byTool['job_search.interview_participants']).toHaveLength(0);
  });

  it("renames a round, writes its notes and renumbers it as the round card does", async () => {
    const { saveInterviewGroup } = await import('@/app/jobs/(app)/roles/[id]/interview-actions');
    const { byButton, byTool } = await bothWays(
      interviewSeed,
      () => saveInterviewGroup(R2, { label: 'Superday', notes: 'Long day.', roundNumber: 3 }),
      'change_interview_round',
      { action: 'edit', role_ref: ROLE, round_number: 2, label: 'Superday', notes: 'Long day.', new_round_number: 3 },
    );
    expect(byTool).toEqual(byButton);
  });

  it('takes an email off a round as the round card does', async () => {
    const { unlinkRoundMessage } = await import('@/app/jobs/(app)/roles/[id]/interview-actions');
    const { byButton, byTool } = await bothWays(interviewSeed, () => unlinkRoundMessage({ groupId: R2, messageId: ROUND_MAIL }), 'change_interview_round', {
      action: 'detach_email',
      role_ref: ROLE,
      round_number: 2,
    });
    expect(byTool).toEqual(byButton);
  });

  it('moves an interview into a round of its own as "not part of this round" does', async () => {
    const { ungroupInterview } = await import('@/app/jobs/(app)/roles/[id]/interview-actions');
    const { byButton, byTool } = await bothWays(interviewSeed, () => ungroupInterview(I3), 'change_interview_round', { action: 'split', interview_ref: I3 });
    expect(byTool).toEqual(byButton);
    expect(byTool['job_search.interview_groups']).toHaveLength(3);
  });

  it('gathers interviews into one round as "Make them one round" does, emails and all (plan #2473.7)', async () => {
    const { groupInterviews } = await import('@/app/jobs/(app)/roles/[id]/interview-actions');
    const { byButton, byTool } = await bothWays(
      interviewSeed,
      () => groupInterviews({ applicationId: APP, interviewIds: [I1, I2, I3], label: 'Superday' }),
      'change_interview_round',
      { action: 'group', role_ref: ROLE, round_numbers: [1, 2], label: 'Superday' },
    );
    // The one difference is where they go: the button makes a new round,
    // numbered after the others, and the tool keeps the first round named.
    // Past the round's id and number (and the columns a seeded row and a new
    // one spell differently) the rows are the same.
    const oneRound = (tables: Record<string, unknown[]>) => {
      const rounds = (tables['job_search.interview_groups'] as string[]).map((row) => JSON.parse(row) as Record<string, unknown>);
      expect(rounds).toHaveLength(1);
      const [round] = rounds;
      const id = JSON.stringify(round.id);
      return {
        number: round.round_number,
        tables: <Record<string, unknown[]>>{
          ...Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, (rows as string[]).map((row) => row.replaceAll(id, '"<round>"')).sort()])),
          'job_search.interview_groups': [{ application_id: round.application_id, user_id: round.user_id, label: round.label, notes: round.notes ?? null }],
        },
      };
    };
    const pressed = oneRound(byButton);
    const told = oneRound(byTool);
    expect(told.tables).toEqual(pressed.tables);
    expect([pressed.number, told.number]).toEqual([3, 1]);
    const interviews = (told.tables['job_search.interviews'] as string[]).map((row) => JSON.parse(row) as Record<string, unknown>);
    expect(interviews.map((row) => [row.id, row.group_id, row.round]).sort()).toEqual([
      [I1, '<round>', 1],
      [I2, '<round>', 2],
      [I3, '<round>', 3],
    ]);
    expect(told.tables['job_search.interview_group_messages']).toHaveLength(1);
    expect(told.tables['job_search.interview_group_messages'][0]).toContain('"group_id":"<round>"');
  });

  it('keeps a round the button empties when it holds notes, rather than losing them', async () => {
    const { groupInterviews } = await import('@/app/jobs/(app)/roles/[id]/interview-actions');
    session.tables = interviewSeed();
    session.tables['job_search.interview_groups'][0].notes = 'The recruiter liked the portfolio.';
    expect(await groupInterviews({ applicationId: APP, interviewIds: [I1, I2, I3] })).toEqual({ error: null });
    const rounds = session.tables['job_search.interview_groups'];
    expect(rounds.map((row) => row.id)).toContain(R1);
    expect(rounds.map((row) => row.id)).not.toContain(R2);
  });

  it('attaches an email to a round as the round card does', async () => {
    const { linkRoundMessage } = await import('@/app/jobs/(app)/roles/[id]/interview-actions');
    const { byButton, byTool } = await bothWays(interviewSeed, () => linkRoundMessage({ groupId: R1, messageId: MAIL }), 'link_round_email', {
      role_ref: ROLE,
      round_number: 1,
      message_ref: `${ACCOUNT}:def`,
    });
    expect(byTool).toEqual(byButton);
  });
});

const FLAGGED = 'bbbbbbbb-0000-4000-8000-000000000001';
const FLAGGED_2 = 'bbbbbbbb-0000-4000-8000-000000000002';
const QUEUED = 'bbbbbbbb-0000-4000-8000-000000000003';
const QUEUED_2 = 'bbbbbbbb-0000-4000-8000-000000000004';
const MAILBOX = 'bbbbbbbb-0000-4000-8000-000000000005';

function reviewSeed(): FakeTables {
  const tables = applicationSeed();
  Object.assign(tables['job_search.applications'][0], { status: 'rejected', status_manual_override: null, needs_review: true });
  const verdicts = [
    { id: QUEUED, classification: 'interview_invite', parse_status: 'needs_review', resulting_application_id: APP, link_method: 'thread', link_confidence: 0.6, error: null },
    { id: QUEUED_2, classification: 'recruiter_reply', parse_status: 'needs_review', resulting_application_id: null, link_method: null, link_confidence: null, error: 'no role found' },
  ];
  return {
    ...tables,
    'core.email_accounts': [{ id: MAILBOX, user_id: ME }],
    'job_search.application_events': [
      { id: FLAGGED, user_id: ME, application_id: APP, kind: 'email_received', summary: 'Recruiter wrote', needs_review: true, acknowledged_at: null },
      { id: FLAGGED_2, user_id: ME, application_id: APP, kind: 'email_received', summary: 'And again', needs_review: true, acknowledged_at: null },
    ],
    'job_search.ingested_messages': verdicts.map((row) => ({ ...row })),
    // A view over the verdicts in the database; two lists here, kept alike.
    'job_search.inbox_messages': verdicts.map((row, i) => ({ ...row, user_id: ME, email_account_id: MAILBOX, provider_message_id: `m${i + 1}`, subject: `Mail ${i + 1}` })),
  };
}

/** The verdicts alone: the stand-in keeps the inbox view as a list of its own, which the button reads and the write does not touch. */
const verdictsOf = (tables: Record<string, unknown[]>) => tables['job_search.ingested_messages'];

describe('the review tools write the rows Jobs review does', () => {
  it('confirms an application the inbox found as Confirm does', async () => {
    const { confirmApplication } = await import('@/app/jobs/(app)/review/actions');
    const { byButton, byTool } = await bothWays(reviewSeed, () => confirmApplication(APP), 'review_application', { verb: 'confirm', application_ref: APP });
    expect(byTool).toEqual(byButton);
  });

  it('reopens a closed pursuit, with its timeline line, as Reopen does', async () => {
    const { reopenApplication } = await import('@/app/jobs/(app)/review/actions');
    const { byButton, byTool } = await bothWays(reviewSeed, () => reopenApplication(APP, 'in_process'), 'review_application', {
      verb: 'reopen',
      application_ref: APP,
      status: 'in_process',
    });
    expect(byTool).toEqual(byButton);
  });

  it('acknowledges one flagged event as Acknowledge does', async () => {
    const { acknowledgeEvent } = await import('@/app/jobs/(app)/review/actions');
    const { byButton, byTool } = await bothWays(reviewSeed, () => acknowledgeEvent(FLAGGED), 'review_events', { verb: 'acknowledge', event_refs: [FLAGGED] });
    expect(byTool).toEqual(byButton);
  });

  it('acknowledges a selection as the bulk bar does', async () => {
    const { acknowledgeEvents } = await import('@/app/jobs/(app)/review/actions');
    const { byButton, byTool } = await bothWays(reviewSeed, () => acknowledgeEvents([FLAGGED, FLAGGED_2]), 'review_events', {
      verb: 'acknowledge',
      event_refs: [FLAGGED, FLAGGED_2],
    });
    expect(byTool).toEqual(byButton);
  });

  it("takes an acknowledgement back as the bulk bar's Undo does", async () => {
    const { unacknowledgeEvents } = await import('@/app/jobs/(app)/review/actions');
    const seed = () => {
      const tables = reviewSeed();
      Object.assign(tables['job_search.application_events'][0], { needs_review: false, acknowledged_at: '2026-10-02T09:00:00Z' });
      return tables;
    };
    const { byButton, byTool } = await bothWays(seed, () => unacknowledgeEvents([FLAGGED]), 'review_events', { verb: 'take_back', event_refs: [FLAGGED] });
    expect(byTool).toEqual(byButton);
  });

  it('dismisses an email as the d key does', async () => {
    const { dismissMessage } = await import('@/app/jobs/(app)/review/actions');
    const { byButton, byTool } = await bothWays(reviewSeed, () => dismissMessage(QUEUED), 'review_emails', { verb: 'dismiss', email_refs: [QUEUED] });
    expect(verdictsOf(byTool)).toEqual(verdictsOf(byButton));
  });

  it('dismisses a selection as the bulk bar does', async () => {
    const { dismissMessages } = await import('@/app/jobs/(app)/review/actions');
    const { byButton, byTool } = await bothWays(reviewSeed, () => dismissMessages([QUEUED, QUEUED_2]), 'review_emails', {
      verb: 'dismiss',
      email_refs: [QUEUED, QUEUED_2],
    });
    expect(verdictsOf(byTool)).toEqual(verdictsOf(byButton));
  });

  it("brings a dismissed email back as the bulk bar's Undo does, for the classification it had", async () => {
    const { restoreDismissedMessages } = await import('@/app/jobs/(app)/review/actions');
    const seed = () => {
      const tables = reviewSeed();
      for (const name of ['job_search.ingested_messages', 'job_search.inbox_messages']) {
        Object.assign(tables[name][1], { classification: 'not_relevant', parse_status: 'skipped', error: null });
      }
      return tables;
    };
    const { byButton, byTool } = await bothWays(
      seed,
      () =>
        restoreDismissedMessages([
          { id: QUEUED_2, classification: 'recruiter_reply', parseStatus: 'needs_review', applicationId: null, linkMethod: null, linkConfidence: null, error: null },
        ]),
      'review_emails',
      { verb: 'restore', email_refs: [QUEUED_2], classification: 'recruiter_reply' },
    );
    expect(verdictsOf(byTool)).toEqual(verdictsOf(byButton));
  });
});

const LETTER = 'cccccccc-0000-4000-8000-000000000001';
const LINKED_EVENT = 'cccccccc-0000-4000-8000-000000000002';

function mailSeed(linked: boolean): FakeTables {
  const tables = applicationSeed();
  Object.assign(tables['job_search.applications'][0], { status: 'submitted' });
  const verdict = {
    id: LETTER,
    classification: 'interview_invite',
    parse_status: linked ? 'parsed' : 'needs_review',
    resulting_application_id: linked ? APP : null,
    link_method: linked ? 'manual' : null,
    link_confidence: linked ? 1 : null,
    error: null,
  };
  return {
    ...tables,
    'core.email_accounts': [{ id: MAILBOX, user_id: ME }],
    'job_search.ingested_messages': [{ ...verdict }],
    'job_search.inbox_messages': [{ ...verdict, user_id: ME, email_account_id: MAILBOX, provider_message_id: 'm1', subject: 'Interview with Acme', received_at: '2026-10-02T09:00:00Z' }],
    'job_search.application_events': linked
      ? [{ id: LINKED_EVENT, user_id: ME, application_id: APP, kind: 'interview_scheduled', ingested_message_id: LETTER, summary: 'Interview with Acme' }]
      : [],
    'job_search.interviews': [],
    'job_search.interview_groups': [],
    'job_search.message_link_dismissals': [],
  };
}

describe("change_role_email and add_role_from_email write the rows the role page's mail and Jobs review do", () => {
  it('links an email, filing its event and booking its round, as the review queue does', async () => {
    const { linkMessage } = await import('@/app/jobs/(app)/review/actions');
    const { byButton, byTool } = await bothWays(() => mailSeed(false), () => linkMessage(LETTER, APP), 'change_role_email', {
      action: 'link',
      application_ref: APP,
      email_ref: LETTER,
    });
    expect(verdictsOf(byTool)).toEqual(verdictsOf(byButton));
    for (const table of ['job_search.application_events', 'job_search.interviews', 'job_search.interview_groups']) {
      expect(byTool[table], table).toEqual(byButton[table]);
    }
    expect(byTool['job_search.application_events']).toHaveLength(1);
  });

  it("links a suggested email as the mail tab's link does", async () => {
    const { linkCandidateMessage } = await import('@/app/jobs/(app)/roles/[id]/mail-actions');
    const { byButton, byTool } = await bothWays(() => mailSeed(false), () => linkCandidateMessage(LETTER, APP), 'change_role_email', {
      action: 'link',
      application_ref: APP,
      email_ref: LETTER,
    });
    expect(verdictsOf(byTool)).toEqual(verdictsOf(byButton));
    expect(byTool['job_search.application_events']).toEqual(byButton['job_search.application_events']);
  });

  it('turns a suggestion down as "not this one" does', async () => {
    const { declineCandidateMessage } = await import('@/app/jobs/(app)/roles/[id]/mail-actions');
    const { byButton, byTool } = await bothWays(() => mailSeed(false), () => declineCandidateMessage(LETTER, APP), 'change_role_email', {
      action: 'decline',
      application_ref: APP,
      email_ref: LETTER,
    });
    expect(byTool).toEqual(byButton);
  });

  it('unlinks an email back to the queue, taking its events, as the mail tab does', async () => {
    const { unlinkMessage } = await import('@/app/jobs/(app)/roles/[id]/mail-actions');
    const { byButton, byTool } = await bothWays(() => mailSeed(true), () => unlinkMessage(LETTER, APP), 'change_role_email', {
      action: 'unlink',
      application_ref: APP,
      email_ref: LETTER,
    });
    expect(verdictsOf(byTool)).toEqual(verdictsOf(byButton));
    for (const table of ['job_search.application_events', 'job_search.message_link_dismissals']) {
      expect(byTool[table], table).toEqual(byButton[table]);
    }
  });

  it('makes a new role from an email and links it, as the review queue\'s "new role" does', async () => {
    const { createRoleFromMessage } = await import('@/app/jobs/(app)/review/actions');
    const seed = () => {
      const tables = mailSeed(false);
      tables['job_search.roles'] = [];
      tables['job_search.applications'] = [];
      return tables;
    };
    const { byButton, byTool } = await bothWays(
      seed,
      () => createRoleFromMessage({ messageId: LETTER, companyName: 'Globex', title: 'Data Engineer' }),
      'add_role_from_email',
      { email_ref: LETTER, company: 'Globex', title: 'Data Engineer' },
    );
    for (const table of ['job_search.companies', 'job_search.roles', 'job_search.applications', 'job_search.application_events', 'job_search.interviews']) {
      expect(byTool[table], table).toEqual(byButton[table]);
    }
    expect(verdictsOf(byTool)).toEqual(verdictsOf(byButton));
  });
});

describe('merge_roles folds roles as the Merge roles button does (plan #2473.6)', () => {
  const ROLE_2 = '11111111-1111-4111-8111-111111111112';
  const APP_1 = '33333333-3333-4333-8333-333333333331';
  const APP_2 = '33333333-3333-4333-8333-333333333332';
  const QUESTION = '99999999-9999-4999-8999-999999999991';

  /** Two filings of one posting, each with an application and rows on it, some of them twins. */
  function dupesSeed(): FakeTables {
    const tables = roleSeed();
    tables['job_search.roles'].push({ ...tables['job_search.roles'][0], id: ROLE_2, title: 'Data Engineer' });
    tables['job_search.applications'] = [
      { id: APP_1, user_id: ME, role_id: ROLE, attempt: 1, status: 'submitted', status_manual_override: null, created_at: '2026-10-01T00:00:00Z' },
      { id: APP_2, user_id: ME, role_id: ROLE_2, attempt: 1, status: 'in_process', status_manual_override: 'in_process', created_at: '2026-10-02T00:00:00Z' },
    ];
    tables['job_search.application_events'] = [{ id: 'e0000000-0000-4000-8000-000000000001', user_id: ME, application_id: APP_1 }];
    tables['job_search.application_answers'] = [
      { id: 'a0000000-0000-4000-8000-000000000001', user_id: ME, application_id: APP_1, question_id: QUESTION },
      { id: 'a0000000-0000-4000-8000-000000000002', user_id: ME, application_id: APP_2, question_id: QUESTION },
    ];
    tables['job_search.interviews'] = [{ id: 'b0000000-0000-4000-8000-000000000001', user_id: ME, application_id: APP_1, ics_uid: null }];
    tables['job_search.fact_origins'] = [
      { id: 'f0000000-0000-4000-8000-000000000001', user_id: ME, role_id: ROLE, field: 'location', origin: 'you' },
      { id: 'f0000000-0000-4000-8000-000000000002', user_id: ME, role_id: ROLE_2, field: 'location', origin: 'posting' },
      { id: 'f0000000-0000-4000-8000-000000000003', user_id: ME, role_id: ROLE_2, field: 'seniority', origin: 'posting' },
    ];
    tables['todo.task_links'] = [{ id: 'c0000000-0000-4000-8000-000000000001', role_id: ROLE_2, application_id: APP_1 }];
    // Every row has its time, as the database gives it, so one put back whole compares equal.
    for (const rows of Object.values(tables)) for (const row of rows) row.created_at ??= '2026-09-30T00:00:00Z';
    return tables;
  }

  function toolEnv(tables: FakeTables): JobsWriteEnv {
    const db = fakeSchemaDb(tables);
    return { userId: ME, jobs: db('job_search'), todo: db('todo'), core: db('core') };
  }

  const merge = JOBS_WRITES.find((entry) => entry.name === 'merge_roles')!;

  /** The rows, leaving out the tables a read left empty in the in-memory database. */
  const rowsOf = (tables: FakeTables) =>
    Object.fromEntries(Object.entries(settled(tables, new Set())).filter(([, rows]) => rows.length > 0));

  it('writes the same rows as the button, and its Undo puts every one back', async () => {
    const { mergeRoles } = await import('@/app/jobs/(app)/companies/actions');
    session.tables = dupesSeed();
    expect(await mergeRoles({ companyId: COMPANY, survivorRoleId: ROLE, mergedRoleIds: [ROLE_2] })).toEqual({ error: null });
    const byButton = rowsOf(session.tables);

    const tables = dupesSeed();
    const result = await runJobsWrite(merge, toolEnv(tables), { keep_role_ref: ROLE, merge_role_refs: [ROLE_2] });
    if ('ok' in result) throw new Error(`the tool refused: ${result.error}`);
    expect(rowsOf(tables)).toEqual(byButton);
    // It did fold: one role, the application furthest along on it, the twin answer and origin taken out.
    expect(tables['job_search.roles'].map((r) => r.id)).toEqual([ROLE]);
    expect(tables['job_search.applications']).toEqual([
      expect.objectContaining({ id: APP_2, role_id: ROLE, attempt: 1, status_manual_override: 'in_process' }),
    ]);
    expect(tables['job_search.application_answers'].map((r) => r.id)).toEqual(['a0000000-0000-4000-8000-000000000002']);
    expect(tables['job_search.fact_origins'].map((r) => r.id).sort()).toEqual([
      'f0000000-0000-4000-8000-000000000001',
      'f0000000-0000-4000-8000-000000000003',
    ]);

    const db = fakeSchemaDb(tables);
    expect(await undoRoleMerge({ userId: ME, db: async (schema) => db(schema) }, result.undo)).toMatchObject({ ok: true });
    expect(rowsOf(tables)).toEqual(rowsOf(dupesSeed()));
  });

  it('refuses, as the button does, a duplicate with comments in its thread', async () => {
    const turn = { id: fakeId(), user_id: ME, ref: `job_search.roles:${ROLE_2}`, author: 'me', body: 'Hi' };
    const tables = dupesSeed();
    tables['core.conversation_turns'] = [turn];
    const result = await runJobsWrite(merge, toolEnv(tables), { keep_role_ref: ROLE, merge_role_refs: [ROLE_2] });
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/comments in its thread/) });
    expect(tables['job_search.roles']).toHaveLength(2);

    const { mergeRoles } = await import('@/app/jobs/(app)/companies/actions');
    session.tables = { ...dupesSeed(), 'core.conversation_turns': [turn] };
    expect(await mergeRoles({ companyId: COMPANY, survivorRoleId: ROLE, mergedRoleIds: [ROLE_2] })).toMatchObject({
      error: expect.stringMatching(/comments in its thread/),
    });
    expect(session.tables['job_search.roles']).toHaveLength(2);
  });
});
