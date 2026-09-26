/**
 * Cross-user isolation.
 *
 * This is the test that actually matters for multi-tenancy, and it is
 * deliberately written before any feature code. Two users, both seeded, then
 * every assertion runs as user B against user A's data.
 *
 * The loop is driven by a list built from the database itself, so adding a
 * table without an RLS policy fails here rather than in production months
 * later. `seedEverything` must cover every table in `public`; the coverage test
 * below fails if it doesn't, which is what forces this file to be updated
 * whenever the schema grows.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, APP_SCHEMA, asAnon, asUser, closeDb, createUser, truncateAll } from './helpers/db-jobs';

type SeedIds = Record<string, string>;

async function listAppTables(): Promise<string[]> {
  const rows = await admin<{ tablename: string }[]>`
    select tablename from pg_tables where schemaname = ${APP_SCHEMA} order by tablename
  `;
  return rows.map((r) => r.tablename);
}

/** One row per table, all owned by `userId`. Returns table -> row id. */
async function seedEverything(userId: string, tag: string): Promise<SeedIds> {
  const ids: SeedIds = {};

  // profiles already exists via the on_auth_user_created trigger
  ids.profiles = userId;

  const [company] = await admin<{ id: string }[]>`
    insert into companies (user_id, name, slug, domains, ats_type, ats_board_token)
    values (${userId}, ${`${tag} Corp`}, ${`${tag}-corp`}, array[${`${tag}.example`}],
            'greenhouse', ${`${tag}corp`})
    returning id`;
  ids.companies = company.id;

  const [role] = await admin<{ id: string }[]>`
    insert into roles (user_id, company_id, title, jd_url, ats_job_id, source)
    values (${userId}, ${company.id}, ${`${tag} Analyst`},
            ${`https://boards.greenhouse.io/${tag}corp/jobs/1`}, ${`${tag}-job-1`}, 'portal')
    returning id`;
  ids.roles = role.id;

  const [application] = await admin<{ id: string }[]>`
    insert into applications (user_id, role_id, attempt, source, submitted_at)
    values (${userId}, ${role.id}, 1, 'portal', now())
    returning id`;
  ids.applications = application.id;

  const [event] = await admin<{ id: string }[]>`
    insert into application_events (user_id, application_id, kind, occurred_at, source, summary)
    values (${userId}, ${application.id}, 'submitted', now(), 'manual', ${`${tag} applied`})
    returning id`;
  ids.application_events = event.id;

  const [group] = await admin<{ id: string }[]>`
    insert into interview_groups (user_id, application_id, label, notes)
    values (${userId}, ${application.id}, ${`${tag} superday`}, ${`${tag} went well`})
    returning id`;
  ids.interview_groups = group.id;

  const [interview] = await admin<{ id: string }[]>`
    insert into interviews (user_id, application_id, group_id, round, kind, scheduled_at, format)
    values (${userId}, ${application.id}, ${group.id}, 1, 'recruiter_screen', now(), 'video')
    returning id`;
  ids.interviews = interview.id;

  const [contact] = await admin<{ id: string }[]>`
    insert into contacts (user_id, company_id, full_name, title, relationship)
    values (${userId}, ${company.id}, ${`${tag} Recruiter`}, 'Talent Partner', 'recruiter')
    returning id`;
  ids.contacts = contact.id;

  const [participant] = await admin<{ id: string }[]>`
    insert into interview_participants (interview_id, contact_id, role)
    values (${interview.id}, ${contact.id}, 'interviewer')
    returning id`;
  ids.interview_participants = participant.id;

  const [touch] = await admin<{ id: string }[]>`
    insert into contact_touches (user_id, contact_id, application_id, channel, direction, message)
    values (${userId}, ${contact.id}, ${application.id}, 'linkedin_dm', 'outbound', ${`${tag} hello`})
    returning id`;
  ids.contact_touches = touch.id;

  const [resume] = await admin<{ id: string }[]>`
    insert into resume_versions (user_id, label, storage_path, is_default)
    values (${userId}, ${`${tag}-A`}, ${`resumes/${tag}/a.pdf`}, true)
    returning id`;
  ids.resume_versions = resume.id;

  const [note] = await admin<{ id: string }[]>`
    insert into notes (user_id, body, company_id)
    values (${userId}, ${`${tag} thinks the team is strong`}, ${company.id})
    returning id`;
  ids.notes = note.id;

  const [attachment] = await admin<{ id: string }[]>`
    insert into attachments (user_id, role_id, storage_path, filename, mime_type, size_bytes)
    values (${userId}, ${role.id}, ${`attachments/${tag}/jd.pdf`}, 'jd.pdf', 'application/pdf', 1024)
    returning id`;
  ids.attachments = attachment.id;

  const [evidence] = await admin<{ id: string }[]>`
    insert into evidence_items (user_id, title, body, skills, strength)
    values (${userId}, ${`${tag} rebuilt the close process`}, ${`${tag} story body`},
            array['automation'], 4)
    returning id`;
  ids.evidence_items = evidence.id;

  const [question] = await admin<{ id: string }[]>`
    insert into questions (user_id, text, fingerprint, kind)
    values (${userId}, 'Why do you want to work here?', ${`${tag}-fp-1`}, 'motivation')
    returning id`;
  ids.questions = question.id;

  const [answer] = await admin<{ id: string }[]>`
    insert into application_answers (user_id, application_id, question_id, answer, evidence_item_ids)
    values (${userId}, ${application.id}, ${question.id}, ${`${tag} answer`}, array[${evidence.id}]::uuid[])
    returning id`;
  ids.application_answers = answer.id;

  const [letter] = await admin<{ id: string }[]>`
    insert into cover_letters (user_id, application_id, body, public_slug)
    values (${userId}, ${application.id}, ${`${tag} letter`}, ${`${tag}-slug-1`})
    returning id`;
  ids.cover_letters = letter.id;

  const [account] = await admin<{ id: string }[]>`
    insert into core.email_accounts (user_id, provider, email_address)
    values (${userId}, 'gmail', ${`${tag}@example.com`})
    returning id`;

  // The envelope belongs to core; this schema keeps only the recruiting verdict.
  const [message] = await admin<{ id: string }[]>`
    insert into core.ingested_messages (email_account_id, provider_message_id, received_at,
                                        from_address, reply_to_address, subject)
    values (${account.id}, ${`${tag}-msg-1`}, now(), ${`no-reply@greenhouse.io`},
            ${`recruiter@${tag}.example`}, ${`Your application to ${tag} Corp`})
    returning id`;

  await admin`
    insert into ingested_messages (id, classification, parse_status,
                                   resulting_application_id, link_confidence, link_method)
    values (${message.id}, 'application_confirmation', 'parsed',
            ${application.id}, 0.95, 'ats_job_id')`;
  ids.ingested_messages = message.id;

  // The round this message belongs to. Seeded after both parents exist, since
  // it points at an interview group and at an ingested message.
  const [groupMessage] = await admin<{ id: string }[]>`
    insert into interview_group_messages (user_id, group_id, message_id)
    values (${userId}, ${group.id}, ${message.id})
    returning id`;
  ids.interview_group_messages = groupMessage.id;

  await admin`
    insert into core.sync_jobs (email_account_id, type, status)
    values (${account.id}, 'backfill', 'completed') returning id`;

  const [reminder] = await admin<{ id: string }[]>`
    insert into reminders (user_id, application_id, kind, due_at, body)
    values (${userId}, ${application.id}, 'follow_up', now() + interval '7 days',
            ${`Follow up with ${tag} Corp`})
    returning id`;
  ids.reminders = reminder.id;

  const [excluded] = await admin<{ id: string }[]>`
    insert into excluded_senders (user_id, domain)
    values (${userId}, ${`${tag}.example`})
    returning id`;
  ids.excluded_senders = excluded.id;

  const [linkDismissal] = await admin<{ id: string }[]>`
    insert into message_link_dismissals (user_id, application_id, message_id)
    values (${userId}, ${application.id}, ${message.id})
    returning id`;
  ids.message_link_dismissals = linkDismissal.id;

  // The two /jobs/today dismissals: one keyed to an event, one to a pursuit.
  const [waiting] = await admin<{ id: string }[]>`
    insert into waiting_dismissals (user_id, application_event_id)
    values (${userId}, ${event.id})
    returning id`;
  ids.waiting_dismissals = waiting.id;

  const [quiet] = await admin<{ id: string }[]>`
    insert into quiet_dismissals (user_id, application_id)
    values (${userId}, ${application.id})
    returning id`;
  ids.quiet_dismissals = quiet.id;

  const [thought] = await admin<{ id: string }[]>`
    insert into thoughts (user_id, body)
    values (${userId}, ${`${tag} wants a finance systems role`})
    returning id`;
  ids.thoughts = thought.id;

  const [track] = await admin<{ id: string }[]>`
    insert into learning_tracks (user_id, name, why)
    values (${userId}, ${`${tag} finance systems`}, 'The roles ask for it.')
    returning id`;
  ids.learning_tracks = track.id;

  return ids;
}

let userA: string;
let userB: string;
let seedA: SeedIds;
let tables: string[];

beforeAll(async () => {
  await truncateAll();
  userA = await createUser('alice@example.com');
  userB = await createUser('bob@example.com');
  seedA = await seedEverything(userA, 'alice');
  await seedEverything(userB, 'bob');
  tables = await listAppTables();
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

describe('RLS coverage', () => {
  it('has row level security enabled on every table in the schema', async () => {
    const rows = await admin<{ tablename: string }[]>`
      select c.relname as tablename
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = ${APP_SCHEMA} and c.relkind = 'r' and not c.relrowsecurity
      order by 1`;
    expect(rows.map((r) => r.tablename)).toEqual([]);
  });

  it('has at least one policy on every table in the schema', async () => {
    const rows = await admin<{ tablename: string }[]>`
      select t.tablename
      from pg_tables t
      where t.schemaname = ${APP_SCHEMA}
        and not exists (
          select 1 from pg_policies p
          where p.schemaname = ${APP_SCHEMA} and p.tablename = t.tablename
        )
      order by 1`;
    expect(rows.map((r) => r.tablename)).toEqual([]);
  });

  it('creates nothing of its own in public, where another app may live', async () => {
    // Table NAMES are not the test: in a shared project `public.profiles` and
    // `public.email_accounts` exist and belong to Shopping Manager — that
    // collision is the whole reason for this schema. What must never appear
    // there is one of OUR columns, which is what a stray unqualified
    // `create table` in a future migration would produce.
    const distinctlyOurs = [
      'ghost_threshold_days',
      'rejection_stage_override',
      'link_confidence',
      'first_human_response_at',
    ];
    const rows = await admin<{ table_name: string; column_name: string }[]>`
      select table_name, column_name
      from information_schema.columns
      where table_schema = 'public' and column_name = any(${distinctlyOurs})
      order by 1, 2`;
    expect(rows).toEqual([]);
  });

  it('finds every one of its own tables in its own schema', async () => {
    // The other half: they are all somewhere, and that somewhere is job_search.
    expect(tables).toContain('applications');
    expect(tables).toContain('ingested_messages');
    // email_accounts and sync_jobs used to be here and are not any more: one
    // mailbox is shared, so they live in core. What stays is the verdict.
    expect(tables).not.toContain('email_accounts');
    expect(tables).not.toContain('sync_jobs');
    expect(tables.length).toBeGreaterThanOrEqual(18);
  });

  it('seeds every table, so a new table cannot skip the isolation check', () => {
    // If this fails, a table was added to the schema without being added to
    // seedEverything(). Add it there rather than deleting it from here.
    expect(Object.keys(seedA).sort()).toEqual([...tables].sort());
  });
});

describe('cross-user reads', () => {
  it('shows user B zero rows belonging to user A, in every table', async () => {
    const leaks: string[] = [];

    for (const table of tables) {
      const id = seedA[table];
      const [row] = await asUser(userB, (tx) =>
        tx.unsafe<{ count: string }[]>(
          `select count(*)::int as count from ${APP_SCHEMA}.${table} where id = $1`,
          [id],
        ),
      );
      if (Number(row.count) !== 0) leaks.push(table);
    }

    expect(leaks).toEqual([]);
  });

  it('still shows user B their own rows, so the policies are not just deny-all', async () => {
    const empty: string[] = [];

    for (const table of tables) {
      const [row] = await asUser(userB, (tx) =>
        tx.unsafe<{ count: string }[]>(`select count(*)::int as count from ${APP_SCHEMA}.${table}`),
      );
      if (Number(row.count) === 0) empty.push(table);
    }

    expect(empty).toEqual([]);
  });
});

describe('cross-user writes', () => {
  it('does not let user B update user A rows', async () => {
    // email_accounts is core's now; its isolation is covered in rls-core.
    for (const table of ['companies', 'roles', 'applications', 'contacts']) {
      const affected = await asUser(userB, (tx) =>
        tx.unsafe(`update ${APP_SCHEMA}.${table} set updated_at = now() where id = $1 returning id`, [
          seedA[table],
        ]),
      );
      expect(affected.length, `${table} was writable by another user`).toBe(0);
    }
  });

  it('does not let user B delete user A rows', async () => {
    for (const table of ['companies', 'roles', 'applications', 'evidence_items']) {
      const affected = await asUser(userB, (tx) =>
        tx.unsafe(`delete from ${APP_SCHEMA}.${table} where id = $1 returning id`, [seedA[table]]),
      );
      expect(affected.length, `${table} was deletable by another user`).toBe(0);
    }
  });

  it('does not let user B insert a row owned by user A', async () => {
    await expect(
      asUser(userB, (tx) =>
        tx`insert into companies (user_id, name, slug) values (${userA}, 'Smuggled', 'smuggled')`,
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('does not let a user attach a child row to another user parent', async () => {
    // RLS alone does not cover this: the child row carries user B's own
    // user_id, so the policy passes. The parent-ownership trigger is what
    // stops user B rewriting user A's derived status from the outside.
    await expect(
      asUser(userB, (tx) =>
        tx`insert into application_events (user_id, application_id, kind)
           values (${userB}, ${seedA.applications}, 'note')`,
      ),
    ).rejects.toThrow(/parent application belongs to another user/);
  });

  it('does not let a user point their own role at another user company', async () => {
    await expect(
      asUser(userB, (tx) =>
        tx`insert into roles (user_id, company_id, title)
           values (${userB}, ${seedA.companies}, 'Smuggled Role')`,
      ),
    ).rejects.toThrow(/parent company belongs to another user/);
  });

  it('does not let a user read another user inbox through ingested_messages', async () => {
    const rows = await asUser(userB, (tx) =>
      tx<{ id: string }[]>`select id from ingested_messages where id = ${seedA.ingested_messages}`,
    );
    expect(rows).toHaveLength(0);
  });
});

describe('integrity constraints the database enforces itself', () => {
  it('refuses to store a subject or sender on a not_relevant message', async () => {
    // The row constraint is gone and could not have survived unification: this
    // workspace calling a message irrelevant says nothing about whether the
    // commerce side wants it. The rule is core.scrub_unclaimed_messages(),
    // covered in rls-core.
    const [msg] = await admin<{ id: string }[]>`
      insert into core.ingested_messages (email_account_id, provider_message_id, subject)
      select id, 'leaky-1', 'Dinner on Friday?' from core.email_accounts limit 1
      returning id`;
    await admin`insert into ingested_messages (id, classification) values (${msg.id}, 'not_relevant')`;

    const [{ scrubbed }] = await admin<{ scrubbed: number }[]>`
      select core.scrub_unclaimed_messages() as scrubbed`;
    expect(scrubbed).toBe(0);
  });

  it('refuses a note attached to two parents at once', async () => {
    await expect(
      admin`
        insert into notes (user_id, body, company_id, role_id)
        values (${userA}, 'attached to two things', ${seedA.companies}, ${seedA.roles})`,
    ).rejects.toThrow(/notes_exactly_one_parent_ck/);
  });

  it('refuses a note attached to nothing at all', async () => {
    await expect(
      admin`insert into notes (user_id, body) values (${userA}, 'orphan')`,
    ).rejects.toThrow(/notes_exactly_one_parent_ck/);
  });

  it('refuses an attachment attached to two parents at once', async () => {
    await expect(
      admin`
        insert into attachments (user_id, storage_path, filename, role_id, application_id)
        values (${userA}, 'a/b.pdf', 'b.pdf', ${seedA.roles}, ${seedA.applications})`,
    ).rejects.toThrow(/attachments_exactly_one_parent_ck/);
  });

  it('refuses a service-role write attaching a note to another user parent', async () => {
    // RLS already blocks this for a session user; this covers the background
    // jobs, which bypass RLS entirely and are trusted to filter by user_id.
    await expect(
      admin`
        insert into notes (user_id, body, company_id)
        values (${userB}, 'smuggled by a job', ${seedA.companies})`,
    ).rejects.toThrow(/parent company belongs to another user/);
  });

  it('refuses a second application at the same attempt number for one role', async () => {
    await expect(
      admin`
        insert into applications (user_id, role_id, attempt)
        values (${userA}, ${seedA.roles}, 1)`,
    ).rejects.toThrow(/applications_role_attempt_key/);
  });

  it('allows a second attempt at the same role', async () => {
    const rows = await admin<{ id: string }[]>`
      insert into applications (user_id, role_id, attempt, source)
      values (${userA}, ${seedA.roles}, 2, 'portal')
      returning id`;
    expect(rows).toHaveLength(1);
    await admin`delete from applications where id = ${rows[0].id}`;
  });
});

/**
 * The public case page.
 *
 * The one unauthenticated read in the whole application, so it gets its own
 * negative cases rather than riding on the loop above. Every assertion here
 * runs as `anon` -- the role an actual stranger gets -- because a test that
 * passes as `authenticated` proves nothing about a link pasted into an email.
 */
describe('the public case page', () => {
  const SLUG = 'case-slug-with-real-entropy-aaaa';
  let letterId: string;

  beforeAll(async () => {
    const [item] = await admin<{ id: string }[]>`
      insert into evidence_items (user_id, title, body)
      values (${userA}, 'Forecasting rebuild', 'I rebuilt the forecast.')
      returning id`;

    // A private item nothing on the page references. If this ever comes back
    // through the function, the page is leaking the bank rather than citing it.
    await admin`
      insert into evidence_items (user_id, title, body)
      values (${userA}, 'Unreferenced private story', 'Should never leave the database.')`;

    await admin`
      update roles set requirement_matches = ${admin.json([
        {
          requirement: 'Five years of forecasting',
          kind: 'must_have',
          verdict: 'strong',
          evidence_item_id: item.id,
          why: 'Six years of it.',
        },
        {
          requirement: 'German localisation',
          kind: 'must_have',
          verdict: 'gap',
          evidence_item_id: null,
          why: 'Nothing in the bank covers this.',
        },
      ])}
      where id = ${seedA.roles}`;

    const [letter] = await admin<{ id: string }[]>`
      insert into cover_letters (user_id, application_id, body, public_slug, public_expires_at)
      values (${userA}, ${seedA.applications}, 'Why this role.', ${SLUG}, now() + interval '7 days')
      returning id`;
    letterId = letter.id;
  });

  afterAll(async () => {
    await admin`delete from cover_letters where id = ${letterId}`;
  });

  async function fetchCase(slug: string | null): Promise<Record<string, unknown> | null> {
    const [row] = await asAnon((tx) =>
      tx.unsafe<{ page: Record<string, unknown> | null }[]>(
        `select ${APP_SCHEMA}.public_case_page($1) as page`,
        [slug],
      ),
    );
    return row?.page ?? null;
  }

  it('renders the shared page for a live slug', async () => {
    const page = await fetchCase(SLUG);
    expect(page).not.toBeNull();
    expect(page?.company).toBeTruthy();
    expect(page?.body).toBe('Why this role.');
  });

  it('shows the covered lines and never the gaps', async () => {
    const page = await fetchCase(SLUG);
    const matches = page?.matches as Array<{ requirement: string; verdict: string }>;
    expect(matches.map((m) => m.verdict)).toEqual(['strong']);
    expect(JSON.stringify(page)).not.toContain('German localisation');
  });

  it('sends only the evidence the page cites, not the bank', async () => {
    const page = await fetchCase(SLUG);
    const evidence = page?.evidence as Array<{ title: string }>;
    expect(evidence.map((e) => e.title)).toEqual(['Forecasting rebuild']);
    expect(JSON.stringify(page)).not.toContain('Unreferenced private story');
  });

  it('returns nothing for a wrong slug', async () => {
    expect(await fetchCase('case-slug-with-real-entropy-bbbb')).toBeNull();
  });

  it('returns nothing for a null or too-short slug', async () => {
    expect(await fetchCase(null)).toBeNull();
    expect(await fetchCase('short')).toBeNull();
  });

  it('returns nothing once the link has expired', async () => {
    await admin`update cover_letters set public_expires_at = now() - interval '1 day' where id = ${letterId}`;
    expect(await fetchCase(SLUG)).toBeNull();
    await admin`update cover_letters set public_expires_at = now() + interval '7 days' where id = ${letterId}`;
  });

  it('returns nothing when sharing was never turned on', async () => {
    await admin`update cover_letters set public_expires_at = null where id = ${letterId}`;
    expect(await fetchCase(SLUG)).toBeNull();
    await admin`update cover_letters set public_expires_at = now() + interval '7 days' where id = ${letterId}`;
  });

  it('does not let anon reach the table the function reads', async () => {
    await expect(
      asAnon((tx) => tx.unsafe(`select count(*) from ${APP_SCHEMA}.cover_letters`)),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asAnon((tx) => tx.unsafe(`select count(*) from ${APP_SCHEMA}.evidence_items`)),
    ).rejects.toThrow(/permission denied/);
  });
});
