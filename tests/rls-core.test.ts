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
