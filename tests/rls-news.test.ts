/**
 * Isolation for the news schema.
 *
 * Newsletters arrive on an address rather than through a session, so the two
 * things worth asserting here are that mail written for one account is
 * invisible to another, and that an issue cannot be hung off another account's
 * sender. The second is the one RLS does not do on its own: Postgres performs
 * referential integrity checks bypassing row level security, so a plain
 * `references news.senders (id)` would be satisfied by any sender in the table.
 * The composite key carrying user_id is what refuses it, and this file is where
 * that is checked rather than assumed.
 */
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asUser, closeDb, createUser, truncateAll } from './helpers/db-news';

let userA = '';
let userB = '';
let senderA = '';
let senderB = '';
let issueA = '';

async function createSender(userId: string, email: string, name: string): Promise<string> {
  const [row] = await admin<{ id: string }[]>`
    insert into senders (user_id, email, name) values (${userId}, ${email}, ${name}) returning id`;
  return row.id;
}

beforeAll(async () => {
  await truncateAll();
  userA = await createUser('news-a@example.com');
  userB = await createUser('news-b@example.com');

  await admin`insert into addresses (user_id, local_part) values (${userA}, 'a7f3c92b41d8e650')`;
  await admin`insert into addresses (user_id, local_part) values (${userB}, 'b1e4d70a96c2f385')`;

  senderA = await createSender(userA, 'issues@lettersfromwork.com', 'Letters From Work');
  senderB = await createSender(userB, 'hello@thedaily.example', 'The Daily');

  const [issue] = await admin<{ id: string }[]>`
    insert into issues (user_id, sender_id, message_id, subject, text_body)
    values (${userA}, ${senderA}, '<1@lettersfromwork.com>', 'Week 14', 'Morning.')
    returning id`;
  issueA = issue.id;
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

describe('news.addresses', () => {
  it('shows a user only their own address', async () => {
    const mine = await asUser(userA, (tx) => tx<{ local_part: string }[]>`
      select local_part from addresses`);
    expect(mine.map((r) => r.local_part)).toEqual(['a7f3c92b41d8e650']);

    const theirs = await asUser(userB, (tx) => tx<{ local_part: string }[]>`
      select local_part from addresses`);
    expect(theirs.map((r) => r.local_part)).toEqual(['b1e4d70a96c2f385']);
  });

  it('refuses an address written on somebody else', async () => {
    await expect(
      asUser(userB, (tx) => tx`
        insert into addresses (user_id, local_part) values (${userA}, 'c0d9a8b7e6f5a4b3')`),
    ).rejects.toThrow(/row-level security/);
  });

  it('does not let a user replace another account\'s address', async () => {
    await asUser(userB, async (tx) => {
      const updated = await tx`
        update addresses set local_part = 'deadbeefdeadbeef' where user_id = ${userA}`;
      expect(updated.count).toBe(0);
    });

    const [row] = await admin<{ local_part: string }[]>`
      select local_part from addresses where user_id = ${userA}`;
    expect(row.local_part).toBe('a7f3c92b41d8e650');
  });

  it('holds one address per account, and one account per address', async () => {
    await expect(
      admin`insert into addresses (user_id, local_part) values (${userA}, 'f1f2f3f4f5f6f7f8')`,
    ).rejects.toThrow(/addresses_user_key/);

    // A third account, because the one-per-account constraint would otherwise
    // fire first and the address collision would go unchecked.
    const userC = await createUser('news-c@example.com');
    await expect(
      admin`insert into addresses (user_id, local_part) values (${userC}, 'a7f3c92b41d8e650')`,
    ).rejects.toThrow(/addresses_local_part_key/);
  });
});

describe('news.issues', () => {
  it('shows a user only their own issues', async () => {
    await admin`
      insert into issues (user_id, sender_id, message_id, subject, text_body)
      values (${userB}, ${senderB}, '<1@thedaily.example>', 'Tuesday', 'Evening.')`;

    const mine = await asUser(userA, (tx) => tx<{ subject: string }[]>`
      select subject from issues`);
    expect(mine.map((r) => r.subject)).toEqual(['Week 14']);

    const theirs = await asUser(userB, (tx) => tx<{ subject: string }[]>`
      select subject from issues`);
    expect(theirs.map((r) => r.subject)).toEqual(['Tuesday']);
  });

  it('does not let a user read, mark or delete another account\'s issue', async () => {
    await asUser(userB, async (tx) => {
      const read = await tx<{ id: string }[]>`select id from issues where id = ${issueA}`;
      const marked = await tx`update issues set read_at = now() where id = ${issueA}`;
      const deleted = await tx`delete from issues where id = ${issueA}`;
      expect(read).toEqual([]);
      expect(marked.count).toBe(0);
      expect(deleted.count).toBe(0);
    });

    const [row] = await admin<{ read_at: string | null }[]>`
      select read_at from issues where id = ${issueA}`;
    expect(row.read_at).toBeNull();
  });

  it('refuses an issue hung off another account\'s sender', async () => {
    // The foreign key alone would allow this: referential integrity bypasses
    // RLS, and the policy above only asks who owns the issue. The composite key
    // carrying user_id is what makes it an ownership check.
    await expect(
      admin`
        insert into issues (user_id, sender_id, message_id, text_body)
        values (${userB}, ${senderA}, '<2@lettersfromwork.com>', 'Not yours.')`,
    ).rejects.toThrow(/issues_sender_fk/);
  });

  it('lands a retried delivery once', async () => {
    const insert = () => admin`
      insert into issues (user_id, sender_id, message_id, subject, text_body)
      values (${userA}, ${senderA}, '<3@lettersfromwork.com>', 'Week 15', 'Again.')
      on conflict (user_id, message_id) do nothing`;

    await insert();
    await insert();

    const [row] = await admin<{ count: number }[]>`
      select count(*)::int from issues where message_id = '<3@lettersfromwork.com>'`;
    expect(row.count).toBe(1);
  });

  it('keeps a message the same two accounts were both sent', async () => {
    // A broadcast goes to every subscriber, so the unique index is per account
    // rather than global. Two accounts on one newsletter must both keep a copy.
    await admin`
      insert into issues (user_id, sender_id, message_id, subject, text_body)
      values (${userB}, ${senderB}, '<3@lettersfromwork.com>', 'Week 15', 'Again.')`;

    const [row] = await admin<{ count: number }[]>`
      select count(*)::int from issues where message_id = '<3@lettersfromwork.com>'`;
    expect(row.count).toBe(2);
  });

  it('refuses a message with neither body', async () => {
    await expect(
      admin`
        insert into issues (user_id, sender_id, message_id, subject)
        values (${userA}, ${senderA}, '<4@lettersfromwork.com>', 'Empty')`,
    ).rejects.toThrow(/issues_body_ck/);
  });
});

describe('news.senders', () => {
  it('shows a user only their own senders', async () => {
    const mine = await asUser(userA, (tx) => tx<{ email: string }[]>`select email from senders`);
    expect(mine.map((r) => r.email)).toEqual(['issues@lettersfromwork.com']);

    const theirs = await asUser(userB, (tx) => tx<{ email: string }[]>`select email from senders`);
    expect(theirs.map((r) => r.email)).toEqual(['hello@thedaily.example']);
  });

  it('does not let a user mute another account\'s sender', async () => {
    await asUser(userB, async (tx) => {
      const updated = await tx`update senders set muted = true where id = ${senderA}`;
      expect(updated.count).toBe(0);
    });

    const [row] = await admin<{ muted: boolean }[]>`select muted from senders where id = ${senderA}`;
    expect(row.muted).toBe(false);
  });

  it('stores one row per newsletter, whatever case it writes its address in', async () => {
    await expect(
      admin`
        insert into senders (user_id, email, name)
        values (${userA}, 'Issues@LettersFromWork.com', 'Letters From Work')`,
    ).rejects.toThrow(/senders_email_ck/);

    await expect(
      admin`
        insert into senders (user_id, email, name)
        values (${userA}, 'issues@lettersfromwork.com', 'Letters From Work')`,
    ).rejects.toThrow(/senders_user_email_key/);
  });
});

describe('news.story_passes', () => {
  it('shows a user only the stories they have passed', async () => {
    await asUser(userA, (tx) => tx`
      insert into story_passes (user_id, issue_id, story_index) values (${userA}, ${issueA}, 0)`);

    const mine = await asUser(userA, (tx) => tx<{ story_index: number }[]>`
      select story_index from story_passes`);
    expect(mine.map((r) => r.story_index)).toEqual([0]);

    const theirs = await asUser(userB, (tx) => tx`select 1 from story_passes`);
    expect(theirs).toHaveLength(0);
  });

  it('records a story once per newsletter', async () => {
    await expect(
      admin`insert into story_passes (user_id, issue_id, story_index) values (${userA}, ${issueA}, 0)`,
    ).rejects.toThrow(/story_passes_pkey/);

    await expect(
      admin`insert into story_passes (user_id, issue_id, story_index) values (${userA}, ${issueA}, -1)`,
    ).rejects.toThrow(/story_passes_index_ck/);
  });

  it('refuses a pass on another account\'s newsletter, even under their id', async () => {
    await expect(
      asUser(userB, (tx) => tx`
        insert into story_passes (user_id, issue_id, story_index) values (${userB}, ${issueA}, 1)`),
    ).rejects.toThrow(/story_passes_issue_fk/);

    await expect(
      asUser(userB, (tx) => tx`
        insert into story_passes (user_id, issue_id, story_index) values (${userA}, ${issueA}, 1)`),
    ).rejects.toThrow(/row-level security/);
  });
});

describe('news.hidden_topics', () => {
  it('shows a user only the topics they have hidden, once each', async () => {
    await asUser(userA, (tx) => tx`
      insert into hidden_topics (user_id, topic) values (${userA}, 'Sport')`);

    const mine = await asUser(userA, (tx) => tx<{ topic: string }[]>`
      select topic from hidden_topics`);
    expect(mine.map((r) => r.topic)).toEqual(['Sport']);

    const theirs = await asUser(userB, (tx) => tx`select 1 from hidden_topics`);
    expect(theirs).toHaveLength(0);

    await expect(
      admin`insert into hidden_topics (user_id, topic) values (${userA}, 'Sport')`,
    ).rejects.toThrow(/hidden_topics_pkey/);
  });

  it('refuses a topic hidden under another account\'s id', async () => {
    await expect(
      asUser(userB, (tx) => tx`
        insert into hidden_topics (user_id, topic) values (${userA}, 'Politics')`),
    ).rejects.toThrow(/row-level security/);
  });
});

describe('news.saved_stories', () => {
  const story = {
    headline: 'The quiet return of the tram',
    summary: 'Cities are laying track again. Most of it follows old routes.',
  };

  function save(tx: postgres.TransactionSql, userId: string, issueId: string | null) {
    return tx`
      insert into saved_stories (user_id, issue_id, headline, summary, sender_name, received_at)
      values (${userId}, ${issueId}, ${story.headline}, ${story.summary}, 'Letters From Work', now())
      on conflict (user_id, issue_id, headline) do nothing`;
  }

  it('saves a story once, and removes it', async () => {
    await asUser(userA, (tx) => save(tx, userA, issueA));
    await asUser(userA, (tx) => save(tx, userA, issueA));

    const saved = await asUser(userA, (tx) => tx<{ headline: string }[]>`
      select headline from saved_stories where issue_id = ${issueA}`);
    expect(saved.map((r) => r.headline)).toEqual([story.headline]);

    await asUser(userA, (tx) => tx`
      delete from saved_stories where issue_id = ${issueA} and headline = ${story.headline}`);
    const after = await asUser(userA, (tx) => tx`select 1 from saved_stories`);
    expect(after).toHaveLength(0);
  });

  it('does not let another account read, change or remove a saved story', async () => {
    await asUser(userA, (tx) => save(tx, userA, issueA));

    await asUser(userB, async (tx) => {
      const read = await tx`select 1 from saved_stories`;
      const changed = await tx`update saved_stories set headline = 'Mine now'`;
      const removed = await tx`delete from saved_stories`;
      expect(read).toHaveLength(0);
      expect(changed.count).toBe(0);
      expect(removed.count).toBe(0);
    });

    const [row] = await admin<{ headline: string }[]>`
      select headline from saved_stories where user_id = ${userA}`;
    expect(row.headline).toBe(story.headline);
  });

  it('refuses a save on another account\'s newsletter, or under their id', async () => {
    await expect(asUser(userB, (tx) => save(tx, userB, issueA))).rejects.toThrow(
      /saved_stories_issue_fk/,
    );
    await expect(asUser(userB, (tx) => save(tx, userA, null))).rejects.toThrow(
      /row-level security/,
    );
  });

  it('keeps the saved copy when its newsletter is deleted', async () => {
    const [issue] = await admin<{ id: string }[]>`
      insert into issues (user_id, sender_id, message_id, subject, text_body)
      values (${userA}, ${senderA}, '<5@lettersfromwork.com>', 'Week 16', 'Trams.')
      returning id`;
    await admin.begin((tx) => save(tx, userA, issue.id));

    await admin`delete from issues where id = ${issue.id}`;

    const rows = await admin<{ issue_id: string | null; user_id: string }[]>`
      select issue_id, user_id from saved_stories where user_id = ${userA} and issue_id is null`;
    expect(rows).toEqual([{ issue_id: null, user_id: userA }]);
  });
});

describe('RLS coverage', () => {
  it('has row level security enabled on every table in the schema', async () => {
    const rows = await admin<{ tablename: string }[]>`
      select c.relname as tablename
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'news' and c.relkind = 'r' and not c.relrowsecurity
      order by 1`;
    expect(rows.map((r) => r.tablename)).toEqual([]);
  });

  it('seeds every table, so a new one cannot skip the isolation check', async () => {
    const rows = await admin<{ tablename: string }[]>`
      select c.relname as tablename
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'news' and c.relkind = 'r'
      order by 1`;
    expect(rows.map((r) => r.tablename)).toEqual([
      'addresses',
      'hidden_topics',
      'issues',
      'saved_stories',
      'senders',
      'story_passes',
    ]);
  });

  it('reaches nothing in the schema as an anonymous visitor', async () => {
    const rows = await admin<{ grantee: string }[]>`
      select distinct grantee from information_schema.role_table_grants
      where table_schema = 'news' and grantee = 'anon'`;
    expect(rows.map((r) => r.grantee)).toEqual([]);
  });
});
