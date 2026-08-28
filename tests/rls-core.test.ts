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
