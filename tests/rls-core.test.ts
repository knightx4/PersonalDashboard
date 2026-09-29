/**
 * Isolation and retention for the shared ingestion schema.
 *
 * core holds the things worth protecting most: the encrypted Gmail refresh
 * token, and the sender and subject of every message either workspace was
 * offered. Both workspaces read it, so "whose row is this" can no longer be
 * answered by the table that holds the row -- it goes through
 * core.owns_message(), and that indirection is exactly the kind of thing that
 * looks fine and silently returns everyone's data.
 *
 * The scrub tests are the other half. Unification changed what "not relevant"
 * means: it used to be one app's verdict and a row constraint could enforce
 * that nothing was kept about such a message. Now it is one workspace's
 * opinion, and the message the commerce side discards may be the rejection
 * letter the job side is keeping.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asUser, closeDb, createUser, truncateAll } from './helpers/db-core';

let userA = '';
let userB = '';
let accountA = '';
let messageA = '';
let personA = '';

async function seedMessage(
  accountId: string,
  providerId: string,
  subject: string,
): Promise<string> {
  const [row] = await admin<{ id: string }[]>`
    insert into ingested_messages (email_account_id, provider_message_id, subject, from_address)
    values (${accountId}, ${providerId}, ${subject}, ${'sender@example.com'})
    returning id`;
  return row.id;
}

beforeAll(async () => {
  await truncateAll();
  userA = await createUser('core-a@example.com');
  userB = await createUser('core-b@example.com');

  const [account] = await admin<{ id: string }[]>`
    insert into email_accounts (user_id, provider, email_address, oauth_refresh_token)
    values (${userA}, 'gmail', 'core-a@example.com', 'encrypted-token')
    returning id`;
  accountA = account.id;

  const [person] = await admin<{ id: string }[]>`
    insert into people (user_id, name, is_default)
    values (${userA}, 'Chris', true)
    returning id`;
  personA = person.id;
  await admin`update email_accounts set person_id = ${personA} where id = ${accountA}`;

  messageA = await seedMessage(accountA, 'core-msg-1', 'Your order shipped');
  await admin`
    insert into core.sync_jobs (email_account_id, type, status)
    values (${accountA}, 'backfill', 'completed')`;
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

describe('RLS coverage', () => {
  it('has row level security enabled on every table in core', async () => {
    const rows = await admin<{ tablename: string }[]>`
      select c.relname as tablename
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'core' and c.relkind = 'r' and not c.relrowsecurity
      order by 1`;
    expect(rows.map((r) => r.tablename)).toEqual([]);
  });
});

describe('saved views', () => {
  /**
   * An arrangement of a list, kept on the account so it is there on the phone
   * too. What it carries is what the person was looking at -- their filters,
   * their search -- so it is as much theirs as anything else in here.
   */
  async function seedView(userId: string, name: string, isDefault = false): Promise<string> {
    const [row] = await admin<{ id: string }[]>`
      insert into saved_views (user_id, list, name, query, is_default)
      values (${userId}, '/shopping/orders', ${name}, 'group=merchant&sort=total_desc', ${isDefault})
      returning id`;
    return row.id;
  }

  it('shows the owner their own views and another user none of them', async () => {
    const id = await seedView(userA, 'Big ones by merchant');

    const mine = await asUser(userA, (tx) => tx`select id from saved_views where id = ${id}`);
    expect(mine).toHaveLength(1);

    const theirs = await asUser(userB, (tx) => tx`select id, query from saved_views`);
    expect(theirs).toHaveLength(0);
  });

  it('does not let another user rename or delete one', async () => {
    const id = await seedView(userA, 'Renameable');

    const renamed = await asUser(
      userB,
      (tx) => tx`update saved_views set name = 'Theirs now' where id = ${id} returning id`,
    );
    expect(renamed).toHaveLength(0);

    const deleted = await asUser(
      userB,
      (tx) => tx`delete from saved_views where id = ${id} returning id`,
    );
    expect(deleted).toHaveLength(0);
  });

  it('refuses a second view with the same name on the same list', async () => {
    await seedView(userA, 'Only one');
    await expect(seedView(userA, 'only ONE')).rejects.toThrow();
  });

  it('lets two accounts each have a view of that name', async () => {
    await seedView(userA, 'Shared name');
    await expect(seedView(userB, 'Shared name')).resolves.toBeTruthy();
  });

  it('refuses a second default on one list', async () => {
    await seedView(userA, 'First default', true);
    await expect(seedView(userA, 'Second default', true)).rejects.toThrow();
  });

  it('takes a default per list', async () => {
    await admin`
      insert into saved_views (user_id, list, name, query, is_default)
      values (${userA}, '/jobs/roles', 'Roles default', 'group=status', true)`;
    const defaults = await admin<{ list: string }[]>`
      select list from saved_views where user_id = ${userA} and is_default order by list`;
    expect(defaults.map((row) => row.list)).toEqual(['/jobs/roles', '/shopping/orders']);
  });
});

describe('observations', () => {
  /**
   * What Dash noticed across the modules (plan #1119). The weekly run writes
   * them with the service role; the person reads their own and may change
   * only the verdict, since the page's "not useful" is all they need and the
   * sentence and its evidence are what the verdict is about.
   */
  async function seedObservation(userId: string, week: string): Promise<string> {
    const [row] = await admin<{ id: string }[]>`
      insert into core.observations (user_id, week, position, sentence, evidence, modules, model)
      values (${userId}, ${week}, 1, 'You placed 2 orders in the 3 days after a rejection.',
              ${['job_search.application_events:a', 'public.orders:b']}, ${['shopping', 'jobs']},
              'claude-sonnet-5')
      returning id`;
    return row.id;
  }

  it('shows the owner their observations and another user none', async () => {
    const id = await seedObservation(userA, '2026-09-28');
    expect(await asUser(userA, (tx) => tx`select id from core.observations where id = ${id}`)).toHaveLength(1);
    expect(await asUser(userB, (tx) => tx`select id from core.observations`)).toHaveLength(0);
  });

  it('lets the owner mark one not useful, and nobody else', async () => {
    const id = await seedObservation(userA, '2026-09-21');
    const theirs = await asUser(
      userB,
      (tx) => tx`update core.observations set verdict = 'not_useful', verdict_at = now() where id = ${id} returning id`,
    );
    expect(theirs).toHaveLength(0);
    const mine = await asUser(
      userA,
      (tx) => tx`update core.observations set verdict = 'not_useful', verdict_at = now() where id = ${id} returning verdict`,
    );
    expect(mine).toEqual([{ verdict: 'not_useful' }]);
  });

  it('does not let the owner rewrite the sentence or add one', async () => {
    const id = await seedObservation(userA, '2026-09-14');
    await expect(
      asUser(userA, (tx) => tx`update core.observations set sentence = 'Something else, 1.' where id = ${id}`),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(
        userA,
        (tx) => tx`insert into core.observations (user_id, week, position, sentence, evidence, modules)
                   values (${userA}, '2026-09-07', 1, 'Made up, 1.', ${['a.b:1', 'c.d:2']}, ${['todo', 'vault']})`,
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('refuses a week that does not start on a Monday, and a verdict without a date', async () => {
    await expect(seedObservation(userA, '2026-09-15')).rejects.toThrow(/observations_week_monday_ck/);
    const id = await seedObservation(userA, '2026-09-07');
    await expect(
      admin`update core.observations set verdict = 'useful' where id = ${id}`,
    ).rejects.toThrow(/observations_verdict_at_ck/);
  });
});

describe('year reviews', () => {
  /**
   * The year in review (plan #1121). The page's button writes it under the
   * person's session, so they may insert and update their own rows; a review
   * written after its year ended is kept as it is, by the trigger.
   */
  async function writeReview(userId: string, year: number, complete: boolean) {
    return asUser(
      userId,
      (tx) => tx`insert into core.year_reviews (user_id, year, timezone, through, complete, events, totals, paragraphs, model)
                 values (${userId}, ${year}, 'UTC', now(), ${complete}, 25, '{}'::jsonb,
                         '[{"topic":"shopping","text":"You placed 3 orders.","evidence":["public.orders:a"]}]'::jsonb,
                         'claude-sonnet-5')
                 returning id`,
    );
  }

  it('shows the owner their review and another user none', async () => {
    await writeReview(userA, 2020, false);
    expect(await asUser(userA, (tx) => tx`select year from core.year_reviews where year = 2020`)).toEqual([{ year: 2020 }]);
    expect(await asUser(userB, (tx) => tx`select year from core.year_reviews`)).toHaveLength(0);
  });

  it('refuses a review written for someone else', async () => {
    await expect(
      asUser(
        userB,
        (tx) => tx`insert into core.year_reviews (user_id, year, timezone, through, totals)
                   values (${userA}, 2019, 'UTC', now(), '{}'::jsonb)`,
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('rewrites a review written during the year, and keeps one written after it ended', async () => {
    await writeReview(userA, 2021, false);
    const rewritten = await asUser(
      userA,
      (tx) => tx`update core.year_reviews set events = 30 where year = 2021 returning events`,
    );
    expect(rewritten).toEqual([{ events: 30 }]);

    await writeReview(userA, 2022, true);
    await expect(
      asUser(userA, (tx) => tx`update core.year_reviews set events = 31 where year = 2022`),
    ).rejects.toThrow(/kept as it is/);
  });

  it('refuses paragraphs with no model behind them', async () => {
    await expect(
      admin`insert into core.year_reviews (user_id, year, timezone, through, totals, paragraphs)
            values (${userA}, 2024, 'UTC', now(), '{}'::jsonb, '[{"topic":"jobs"}]'::jsonb)`,
    ).rejects.toThrow(/year_reviews_model_ck/);
  });
});

describe('day briefs', () => {
  /**
   * The morning brief (plan #1123). The hourly run writes it with the service
   * role; the person only reads their own, and cannot write one.
   */
  async function seedBrief(userId: string, day: string): Promise<string> {
    const [row] = await admin<{ id: string }[]>`
      insert into core.day_briefs (user_id, day, body, facts, model)
      values (${userId}, ${day}, 'You have the Acme interview at 09:30.',
              ${admin.json([{ kind: 'booked', text: '09:30: Interview with Acme' }])}, 'claude-haiku-4-5')
      returning id`;
    return row.id;
  }

  it('shows the owner their brief and another user none', async () => {
    const id = await seedBrief(userA, '2026-09-28');
    expect(await asUser(userA, (tx) => tx`select id from core.day_briefs where id = ${id}`)).toHaveLength(1);
    expect(await asUser(userB, (tx) => tx`select id from core.day_briefs`)).toHaveLength(0);
  });

  it('does not let the owner write or rewrite one', async () => {
    const id = await seedBrief(userA, '2026-09-27');
    await expect(
      asUser(userA, (tx) => tx`update core.day_briefs set body = 'Something else.' where id = ${id}`),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(userA, (tx) => tx`insert into core.day_briefs (user_id, day, body) values (${userA}, '2026-09-26', 'Made up.')`),
    ).rejects.toThrow(/permission denied/);
  });

  it('keeps one brief a day', async () => {
    await seedBrief(userA, '2026-09-25');
    await expect(seedBrief(userA, '2026-09-25')).rejects.toThrow(/day_briefs_user_day_uq/);
  });
});

describe('drafted messages', () => {
  /**
   * Follow-ups and return requests (plan #1129). The morning run writes them
   * with the service role; the person reads their own and may only mark one
   * sent, dismiss it or put it off.
   */
  async function seedDraft(userId: string, basis: string): Promise<string> {
    const [row] = await admin<{ id: string }[]>`
      insert into core.drafted_messages
        (user_id, kind, about_id, basis, about_label, subject, body, show_on, expires_at)
      values (${userId}, 'follow_up', '00000000-0000-0000-0000-000000000001', ${basis},
              'Acme', 'Following up', 'Hello,', '2026-09-27', now() + interval '3 days')
      returning id`;
    return row.id;
  }

  it('shows the owner their drafts and another user none', async () => {
    const id = await seedDraft(userA, '2026-09-10T00:00:00.000Z');
    expect(await asUser(userA, (tx) => tx`select id from core.drafted_messages where id = ${id}`)).toHaveLength(1);
    expect(await asUser(userB, (tx) => tx`select id from core.drafted_messages`)).toHaveLength(0);
  });

  it('lets the owner mark one sent but not rewrite it or write one', async () => {
    const id = await seedDraft(userA, '2026-09-11T00:00:00.000Z');
    await asUser(userA, (tx) => tx`update core.drafted_messages set done_at = now() where id = ${id}`);
    const [row] = await admin<{ done_at: Date | null }[]>`select done_at from core.drafted_messages where id = ${id}`;
    expect(row.done_at).not.toBeNull();
    await expect(
      asUser(userA, (tx) => tx`update core.drafted_messages set body = 'Something else.' where id = ${id}`),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(
        userA,
        (tx) => tx`insert into core.drafted_messages
          (user_id, kind, about_id, basis, about_label, subject, body, show_on, expires_at)
          values (${userA}, 'follow_up', '00000000-0000-0000-0000-000000000002', 'x', 'Acme', 's', 'b',
                  '2026-09-27', now())`,
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('does not let another user mark it sent', async () => {
    const id = await seedDraft(userA, '2026-09-12T00:00:00.000Z');
    await asUser(userB, (tx) => tx`update core.drafted_messages set done_at = now() where id = ${id}`);
    const [row] = await admin<{ done_at: Date | null }[]>`select done_at from core.drafted_messages where id = ${id}`;
    expect(row.done_at).toBeNull();
  });

  it('keeps one draft for each quiet stretch', async () => {
    await seedDraft(userA, '2026-09-13T00:00:00.000Z');
    await expect(seedDraft(userA, '2026-09-13T00:00:00.000Z')).rejects.toThrow(/drafted_messages_basis_uq/);
  });
});

describe('cross-user reads', () => {
  it('shows the owner their mailbox, its jobs and its messages', async () => {
    const seen = await asUser(userA, async (tx) => ({
      accounts: (await tx`select id from email_accounts`).length,
      jobs: (await tx`select id from sync_jobs`).length,
      messages: (await tx`select id from ingested_messages`).length,
    }));
    expect(seen).toEqual({ accounts: 1, jobs: 1, messages: 1 });
  });

  it('shows another user none of it', async () => {
    const seen = await asUser(userB, async (tx) => ({
      accounts: (await tx`select id from email_accounts`).length,
      jobs: (await tx`select id from sync_jobs`).length,
      messages: (await tx`select id from ingested_messages`).length,
    }));
    expect(seen).toEqual({ accounts: 0, jobs: 0, messages: 0 });
  });

  it('does not leak a refresh token to another user', async () => {
    const rows = await asUser(
      userB,
      (tx) => tx`select oauth_refresh_token from email_accounts`,
    );
    expect(rows).toHaveLength(0);
  });
});

describe('people', () => {
  it('shows the owner their people', async () => {
    const rows = await asUser(userA, (tx) => tx`select id, name from people`);
    expect(rows).toHaveLength(1);
  });

  it('shows another user none of them', async () => {
    // The names of the people you shop for are as private as the shopping.
    const rows = await asUser(userB, (tx) => tx`select id from people`);
    expect(rows).toHaveLength(0);
  });

  it('does not let another user rename them', async () => {
    const affected = await asUser(
      userB,
      (tx) => tx`update people set name = 'Mallory' where id = ${personA} returning id`,
    );
    expect(affected).toHaveLength(0);
  });

  it('does not let another user delete them', async () => {
    const affected = await asUser(
      userB,
      (tx) => tx`delete from people where id = ${personA} returning id`,
    );
    expect(affected).toHaveLength(0);
  });

  it('allows only one default person per account', async () => {
    await expect(
      admin`insert into people (user_id, name, is_default) values (${userA}, 'Second', true)`,
    ).rejects.toThrow();
  });

  it('treats a name as one person whatever its casing', async () => {
    // "Emma" and "emma" splitting somebody's spending in two is the failure
    // this prevents.
    await expect(
      admin`insert into people (user_id, name) values (${userA}, 'chris')`,
    ).rejects.toThrow();
  });

  it('keeps the shopping when a person is removed', async () => {
    const [victim] = await admin<{ id: string }[]>`
      insert into people (user_id, name) values (${userA}, 'Temporary') returning id`;
    await admin`update email_accounts set person_id = ${victim.id} where id = ${accountA}`;
    await admin`delete from people where id = ${victim.id}`;

    // set null, not cascade: an order that happened still happened.
    const [account] = await admin<{ person_id: string | null }[]>`
      select person_id from email_accounts where id = ${accountA}`;
    expect(account.person_id).toBeNull();

    await admin`update email_accounts set person_id = ${personA} where id = ${accountA}`;
  });
});

describe('cross-user writes', () => {
  it('does not let another user touch the mailbox', async () => {
    const affected = await asUser(
      userB,
      (tx) => tx`update email_accounts set status = 'disconnected' where id = ${accountA} returning id`,
    );
    expect(affected).toHaveLength(0);
  });

  it('does not let another user delete a message', async () => {
    const affected = await asUser(
      userB,
      (tx) => tx`delete from ingested_messages where id = ${messageA} returning id`,
    );
    expect(affected).toHaveLength(0);
  });
});

describe('scrubbing what nobody claimed', () => {
  it('leaves a message alone until every workspace has answered', async () => {
    const id = await seedMessage(accountA, 'scrub-partial', 'Only commerce has looked');
    await admin`insert into public.ingested_messages (id, classification) values (${id}, 'not_relevant')`;

    const [{ scrubbed }] = await admin<{ scrubbed: number }[]>`
      select core.scrub_unclaimed_messages() as scrubbed`;
    expect(scrubbed).toBe(0);

    const [row] = await admin<{ subject: string | null }[]>`
      select subject from ingested_messages where id = ${id}`;
    expect(row.subject).toBe('Only commerce has looked');
  });

  it('keeps a message one workspace wants even when the other discards it', async () => {
    // The case the old row constraint would have destroyed: a rejection letter
    // is nothing to the commerce side, and everything to the job side.
    const id = await seedMessage(accountA, 'scrub-rejection', 'Update on your application');
    await admin`insert into public.ingested_messages (id, classification) values (${id}, 'not_relevant')`;
    await admin`insert into job_search.ingested_messages (id, classification) values (${id}, 'rejection')`;

    await admin`select core.scrub_unclaimed_messages()`;

    const [row] = await admin<{ subject: string | null; from_address: string | null }[]>`
      select subject, from_address from ingested_messages where id = ${id}`;
    expect(row.subject).toBe('Update on your application');
    expect(row.from_address).toBe('sender@example.com');
  });

  it('keeps a subscription receipt the other two discard (plan #1125)', async () => {
    const id = await seedMessage(accountA, 'scrub-receipt', 'Your receipt from Apple.');
    await admin`insert into public.ingested_messages (id, classification) values (${id}, 'not_relevant')`;
    await admin`insert into job_search.ingested_messages (id, classification) values (${id}, 'not_relevant')`;
    await admin`
      insert into public.recurring_messages (id, user_id, claimed, parse_status)
      values (${id}, ${userA}, true, 'parsed')`;

    await admin`select core.scrub_unclaimed_messages()`;

    const [row] = await admin<{ subject: string | null }[]>`
      select subject from ingested_messages where id = ${id}`;
    expect(row.subject).toBe('Your receipt from Apple.');
  });

  it('keeps a booking confirmation the appointments linker claimed (plan #1127)', async () => {
    const id = await seedMessage(accountA, 'scrub-booking', 'Reservation confirmed at Lilia');
    await admin`insert into public.ingested_messages (id, classification) values (${id}, 'not_relevant')`;
    await admin`insert into job_search.ingested_messages (id, classification) values (${id}, 'not_relevant')`;
    await admin`
      insert into todo.appointment_messages (id, user_id, claimed, parse_status)
      values (${id}, ${userA}, true, 'parsed')`;

    await admin`select core.scrub_unclaimed_messages()`;

    const [row] = await admin<{ subject: string | null }[]>`
      select subject from ingested_messages where id = ${id}`;
    expect(row.subject).toBe('Reservation confirmed at Lilia');
  });

  it('scrubs the envelope once nobody wants it', async () => {
    const id = await seedMessage(accountA, 'scrub-unwanted', 'Newsletter');
    await admin`insert into public.ingested_messages (id, classification) values (${id}, 'not_relevant')`;
    await admin`insert into job_search.ingested_messages (id, classification) values (${id}, 'not_relevant')`;

    await admin`select core.scrub_unclaimed_messages()`;

    const [row] = await admin<{
      subject: string | null;
      from_address: string | null;
      thread_id: string | null;
      scrubbed_at: string | null;
    }[]>`select subject, from_address, thread_id, scrubbed_at
          from ingested_messages where id = ${id}`;
    expect(row.subject).toBeNull();
    expect(row.from_address).toBeNull();
    expect(row.thread_id).toBeNull();
    expect(row.scrubbed_at).not.toBeNull();
  });

  it('is idempotent, and never un-scrubs', async () => {
    const [{ scrubbed }] = await admin<{ scrubbed: number }[]>`
      select core.scrub_unclaimed_messages() as scrubbed`;
    expect(scrubbed).toBe(0);
  });
});

describe('re-reading a scrubbed envelope', () => {
  it('restores it in place, keeping the id every verdict hangs off', async () => {
    // A backfill re-reads scrubbed messages from Gmail, because a workspace
    // that did not exist when they were discarded never got its say. The upsert
    // must land on the same row: a new id would orphan both verdicts and any
    // order or application already linked to it.
    const id = await seedMessage(accountA, 'scrub-then-refetch', 'Rejected, apparently');
    await admin`insert into public.ingested_messages (id, classification) values (${id}, 'not_relevant')`;
    await admin`insert into job_search.ingested_messages (id, classification) values (${id}, 'not_relevant')`;
    await admin`select core.scrub_unclaimed_messages()`;

    const [scrubbed] = await admin<{ subject: string | null }[]>`
      select subject from ingested_messages where id = ${id}`;
    expect(scrubbed.subject).toBeNull();

    // What the backfill's upsert does, on conflict.
    await admin`
      insert into ingested_messages (email_account_id, provider_message_id, subject, scrubbed_at)
      values (${accountA}, 'scrub-then-refetch', 'Rejected, apparently', null)
      on conflict (email_account_id, provider_message_id) do update
        set subject = excluded.subject, scrubbed_at = null`;

    const [restored] = await admin<{ id: string; subject: string | null; scrubbed_at: string | null }[]>`
      select id, subject, scrubbed_at from ingested_messages
      where email_account_id = ${accountA} and provider_message_id = 'scrub-then-refetch'`;
    expect(restored.id).toBe(id);
    expect(restored.subject).toBe('Rejected, apparently');
    expect(restored.scrubbed_at).toBeNull();

    // And the verdicts that hung off it are still attached.
    const [verdicts] = await admin<{ n: number }[]>`
      select (
        (select count(*) from public.ingested_messages where id = ${id})
        + (select count(*) from job_search.ingested_messages where id = ${id})
      )::int as n`;
    expect(verdicts.n).toBe(2);
  });
});

/**
 * Account settings: one row per account, yours only, and the mirrors kept true.
 *
 * The mirror assertions are the ones that matter. Two `profiles.timezone`
 * columns still exist and roughly thirty call sites still read them; they are
 * only safe because the database propagates every write, and a propagation
 * that silently stops is a return deadline computed in the wrong day and no
 * error anywhere.
 */
describe('core.account_settings', () => {
  it('creates exactly one row per account, by trigger', async () => {
    const [row] = await admin<{ n: string }[]>`
      select count(*) as n from account_settings where user_id = ${userA}`;
    expect(Number(row.n)).toBe(1);
  });

  it('is readable only by its owner', async () => {
    const mine = await asUser(userA, async (tx) => {
      return tx<{ user_id: string }[]>`select user_id from account_settings`;
    });
    expect(mine.map((r) => r.user_id)).toEqual([userA]);

    const theirs = await asUser(userB, async (tx) => {
      return tx<{ user_id: string }[]>`
        select user_id from account_settings where user_id = ${userA}`;
    });
    expect(theirs).toHaveLength(0);
  });

  it('refuses a write aimed at somebody else', async () => {
    await asUser(userB, async (tx) => {
      const changed = await tx`
        update account_settings set timezone = 'Antarctica/Troll' where user_id = ${userA}`;
      expect(changed.count).toBe(0);
    });

    const [row] = await admin<{ timezone: string }[]>`
      select timezone from account_settings where user_id = ${userA}`;
    expect(row.timezone).not.toBe('Antarctica/Troll');
  });

  it('mirrors the timezone into both profiles rows', async () => {
    await asUser(userA, async (tx) => {
      await tx`update account_settings set timezone = 'Europe/London' where user_id = ${userA}`;
    });

    const [shopping] = await admin<{ timezone: string }[]>`
      select timezone from public.profiles where id = ${userA}`;
    const [jobs] = await admin<{ timezone: string }[]>`
      select timezone from job_search.profiles where id = ${userA}`;

    expect(shopping.timezone).toBe('Europe/London');
    expect(jobs.timezone).toBe('Europe/London');
  });

  it('mirrors the display currency, which only the commerce side has', async () => {
    await asUser(userA, async (tx) => {
      await tx`update account_settings set display_currency = 'GBP' where user_id = ${userA}`;
    });

    const [shopping] = await admin<{ display_currency: string }[]>`
      select display_currency from public.profiles where id = ${userA}`;
    expect(shopping.display_currency).toBe('GBP');
  });

  it('refuses an empty module list, which would hide the app from itself', async () => {
    await expect(
      admin`update account_settings set enabled_modules = '{}' where user_id = ${userA}`,
    ).rejects.toThrow(/account_settings_modules_ck/);
  });

  it('goes when the account does', async () => {
    const throwaway = await createUser('core-settings-gone@example.com');
    await admin`delete from auth.users where id = ${throwaway}`;

    const [row] = await admin<{ n: string }[]>`
      select count(*) as n from account_settings where user_id = ${throwaway}`;
    expect(Number(row.n)).toBe(0);
  });
});

describe('push subscriptions', () => {
  /**
   * Where the morning brief is sent (plan #1124). The account page stores and
   * removes this browser's row on the person's own session; the brief run
   * reads them with the service role.
   */
  const endpoint = (name: string) => `https://push.example/${name}`;

  it('lets the owner add, read and remove their own, and nobody else see them', async () => {
    await asUser(
      userA,
      (tx) => tx`insert into core.push_subscriptions (user_id, endpoint, p256dh, auth)
                 values (${userA}, ${endpoint('a-phone')}, 'key', 'secret')`,
    );
    expect(await asUser(userA, (tx) => tx`select id from core.push_subscriptions`)).toHaveLength(1);
    expect(await asUser(userB, (tx) => tx`select id from core.push_subscriptions`)).toHaveLength(0);
    expect(
      await asUser(userB, (tx) => tx`delete from core.push_subscriptions returning id`),
    ).toHaveLength(0);
    expect(
      await asUser(
        userA,
        (tx) => tx`delete from core.push_subscriptions where endpoint = ${endpoint('a-phone')} returning id`,
      ),
    ).toHaveLength(1);
  });

  it('refuses a row filed under someone else', async () => {
    await expect(
      asUser(
        userB,
        (tx) => tx`insert into core.push_subscriptions (user_id, endpoint, p256dh, auth)
                   values (${userA}, ${endpoint('planted')}, 'key', 'secret')`,
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('keeps one row per browser, and only https endpoints', async () => {
    await admin`insert into core.push_subscriptions (user_id, endpoint, p256dh, auth)
                values (${userA}, ${endpoint('shared')}, 'key', 'secret')`;
    await expect(
      admin`insert into core.push_subscriptions (user_id, endpoint, p256dh, auth)
            values (${userB}, ${endpoint('shared')}, 'key', 'secret')`,
    ).rejects.toThrow(/push_subscriptions_endpoint_uq/);
    await expect(
      admin`insert into core.push_subscriptions (user_id, endpoint, p256dh, auth)
            values (${userA}, 'http://push.example/plain', 'key', 'secret')`,
    ).rejects.toThrow(/push_subscriptions_endpoint_ck/);
  });
});

describe('mail piles (plan #1173)', () => {
  /**
   * Jev's pile for each email, stored beside the linkers' own verdicts. The
   * sync writes it with the service role; the person reads their own. The
   * comparison and agreement functions read across three schemas under
   * security definer, so they are the service role's alone.
   */
  let userC = '';
  let accountC = '';

  async function sortInto(id: string, pile: string, confidence: number): Promise<void> {
    await admin`
      insert into core.mail_piles (id, user_id, pile, confidence, model)
      values (${id}, ${userC}, ${pile}, ${confidence}, 'jev-1.13.0')`;
  }

  beforeAll(async () => {
    userC = await createUser('core-c@example.com');
    const [account] = await admin<{ id: string }[]>`
      insert into email_accounts (user_id, provider, email_address, oauth_refresh_token)
      values (${userC}, 'gmail', 'core-c@example.com', 'encrypted-token')
      returning id`;
    accountC = account.id;
  });

  it('shows the owner their piles and another user none', async () => {
    const id = await seedMessage(accountC, 'pile-own', 'Your statement is ready');
    await sortInto(id, 'bill', 0.93);
    expect(await asUser(userC, (tx) => tx`select id from core.mail_piles where id = ${id}`)).toHaveLength(1);
    expect(await asUser(userA, (tx) => tx`select id from core.mail_piles where id = ${id}`)).toHaveLength(0);
    await expect(
      asUser(userC, (tx) => tx`update core.mail_piles set pile = 'other' where id = ${id}`),
    ).rejects.toThrow(/permission denied/);
  });

  it('refuses a pile outside the eight', async () => {
    const id = await seedMessage(accountC, 'pile-bad', 'Hello');
    await expect(sortInto(id, 'spam', 0.9)).rejects.toThrow(/mail_piles_pile_ck/);
  });

  it('lists unsorted mail that still has a sender or subject', async () => {
    const unsorted = await seedMessage(accountC, 'pile-unsorted', 'Can we talk on Friday?');
    const scrubbed = await seedMessage(accountC, 'pile-scrubbed', 'Gone');
    await admin`update ingested_messages set subject = null, from_address = null, scrubbed_at = now() where id = ${scrubbed}`;
    const rows = await admin<{ id: string }[]>`select id from core.mail_piles_unsorted(${accountC}, 100)`;
    const ids = rows.map((row) => row.id);
    expect(ids).toContain(unsorted);
    expect(ids).not.toContain(scrubbed);
  });

  it('puts each linker\'s verdict beside Jev\'s pile and counts agreement', async () => {
    const order = await seedMessage(accountC, 'pile-order', 'Your order has shipped');
    await admin`insert into public.ingested_messages (id, classification) values (${order}, 'shipping')`;
    await sortInto(order, 'order', 0.97);

    const turnedDown = await seedMessage(accountC, 'pile-turned-down', 'Your Amazon order');
    await admin`
      insert into public.recurring_messages (id, user_id, claimed, parse_status)
      values (${turnedDown}, ${userC}, true, 'not_recurring')`;
    await sortInto(turnedDown, 'bill', 0.6);

    const [row] = await admin<{ rule_piles: string[] }[]>`
      select rule_piles from core.mail_pile_comparison(${userC}) where message_id = ${order}`;
    expect(row.rule_piles).toEqual(['order']);

    const report = await admin<{ linker: string | null; pile: string; rules: number; jev: number; jev_sure: number; agree: number; jev_only: number; agreement: string | null }[]>`
      select * from core.mail_pile_agreement(${userC})`;
    const byPile = Object.fromEntries(report.map((line) => [line.pile, line]));
    expect(byPile.order).toMatchObject({ linker: 'commerce', rules: 1, jev: 1, agree: 1, agreement: '1.000' });
    // The statement from the first test and the Amazon order: Jev said bill
    // twice, once sure, and the recurring reading turned both down or never saw them.
    expect(byPile.bill).toMatchObject({ linker: 'recurring', rules: 0, jev: 2, jev_sure: 1, jev_only: 2, agreement: '0.000' });
    expect(byPile.newsletter).toMatchObject({ linker: null, jev: 0, agreement: null });
  });

  it('keeps the comparison from a signed-in user', async () => {
    await expect(
      asUser(userC, (tx) => tx`select * from core.mail_pile_agreement(${userC})`),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('reply threads (plan #1180)', () => {
  /**
   * A thread Jev is sure needs a reply becomes one Todo task. The candidates
   * and the filing are the service role's; the person reads their own rows.
   */
  let userD = '';
  let accountD = '';

  async function seedThreadMessage(providerId: string, thread: string, subject: string, daysAgo: number) {
    const [row] = await admin<{ id: string }[]>`
      insert into ingested_messages (email_account_id, provider_message_id, thread_id, received_at, subject, from_address)
      values (${accountD}, ${providerId}, ${thread}, now() - make_interval(days => ${daysAgo}), ${subject}, 'Jane <jane@example.com>')
      returning id`;
    return row.id;
  }

  async function sortInto(id: string, pile: string, confidence: number): Promise<void> {
    await admin`
      insert into core.mail_piles (id, user_id, pile, confidence, model)
      values (${id}, ${userD}, ${pile}, ${confidence}, 'jev-1.13.0')`;
  }

  const candidates = () =>
    admin<{ message_id: string; thread_id: string }[]>`
      select message_id, thread_id from todo.reply_candidates(${userD}, 0.8, now() - interval '14 days', 20)`;

  beforeAll(async () => {
    userD = await createUser('core-d@example.com');
    const [account] = await admin<{ id: string }[]>`
      insert into email_accounts (user_id, provider, email_address, oauth_refresh_token)
      values (${userD}, 'gmail', 'core-d@example.com', 'encrypted-token')
      returning id`;
    accountD = account.id;
  });

  it('offers the newest sure message of each recent thread', async () => {
    const first = await seedThreadMessage('reply-1', 'thread-a', 'Lunch?', 2);
    const second = await seedThreadMessage('reply-2', 'thread-a', 'Re: Lunch?', 1);
    const unsure = await seedThreadMessage('reply-3', 'thread-b', 'Hello', 1);
    const old = await seedThreadMessage('reply-4', 'thread-c', 'Last month', 30);
    await sortInto(first, 'needs_reply', 0.9);
    await sortInto(second, 'needs_reply', 0.95);
    await sortInto(unsure, 'needs_reply', 0.5);
    await sortInto(old, 'needs_reply', 0.99);

    expect(await candidates()).toEqual([{ message_id: second, thread_id: 'thread-a' }]);
  });

  it('files one task per thread and remembers a thread it skipped', async () => {
    const [{ message_id }] = await candidates();
    const [filed] = await admin<{ task: string | null }[]>`
      select todo.file_reply_task(${userD}, ${message_id}, 'Reply to Jane: Lunch?', 'body') as task`;
    expect(filed.task).not.toBeNull();
    const [again] = await admin<{ task: string | null }[]>`
      select todo.file_reply_task(${userD}, ${message_id}, 'Reply to Jane: Lunch?', 'body') as task`;
    expect(again.task).toBeNull();
    expect(await candidates()).toEqual([]);
    const tasks = await admin`select id from todo.tasks where user_id = ${userD}`;
    expect(tasks).toHaveLength(1);

    const later = await seedThreadMessage('reply-5', 'thread-a', 'Re: Lunch?', 0);
    await sortInto(later, 'needs_reply', 0.9);
    expect(await candidates()).toEqual([]);

    const automated = await seedThreadMessage('reply-6', 'thread-d', 'Your code', 0);
    await sortInto(automated, 'needs_reply', 0.9);
    const [skipped] = await admin<{ task: string | null }[]>`
      select todo.file_reply_task(${userD}, ${automated}, null, null) as task`;
    expect(skipped.task).toBeNull();
    expect(await candidates()).toEqual([]);
  });

  it('files nothing for a message that is not the user\'s', async () => {
    const [{ id }] = await admin<{ id: string }[]>`
      insert into ingested_messages (email_account_id, provider_message_id, thread_id, subject)
      values (${accountA}, 'reply-other', 'thread-z', 'Hi') returning id`;
    const [row] = await admin<{ task: string | null }[]>`
      select todo.file_reply_task(${userD}, ${id}, 'Reply', null) as task`;
    expect(row.task).toBeNull();
  });

  it('shows the owner their threads and keeps the functions from a signed-in user', async () => {
    expect(await asUser(userD, (tx) => tx`select id from todo.reply_threads`)).toHaveLength(2);
    expect(await asUser(userA, (tx) => tx`select id from todo.reply_threads`)).toHaveLength(0);
    await expect(
      asUser(userD, (tx) => tx`select * from todo.reply_candidates(${userD}, 0.8, now(), 5)`),
    ).rejects.toThrow(/permission denied/);
  });
});
