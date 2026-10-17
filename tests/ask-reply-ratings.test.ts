/**
 * Thumbs on Dash's answers and the weekly reply check (plan #2285.1), against
 * the database.
 *
 * Done when a person can rate and read only their own turns, a rating sits
 * only on an assistant turn with its time set, and each account has one check
 * row per week that nobody else can read.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asUser, closeDb, createUser, truncateAll } from './helpers/db-core';

let userA = '';
let userB = '';
let replyA = '';
let askA = '';
const CONVERSATION = '6f1c1f5e-0000-4000-8000-0000000000e1';

beforeAll(async () => {
  await truncateAll();
  userA = await createUser('ratings-a@example.com');
  userB = await createUser('ratings-b@example.com');
  await admin`
    insert into conversations (id, user_id, subject_kind, subject_ref, title)
    values (${CONVERSATION}, ${userA}, 'ask', ${CONVERSATION}, 'What is due')`;
  const [q] = await admin<{ id: string }[]>`
    insert into conversation_turns (conversation_id, user_id, role, body)
    values (${CONVERSATION}, ${userA}, 'user', 'What is due?') returning id`;
  askA = q.id;
  const [r] = await admin<{ id: string }[]>`
    insert into conversation_turns (conversation_id, user_id, role, body)
    values (${CONVERSATION}, ${userA}, 'assistant', 'Nothing.') returning id`;
  replyA = r.id;
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

describe('a rating on a Dash answer', () => {
  it('is kept by its owner, with a note, and is not visible to or changeable by another account', async () => {
    await asUser(userA, (tx) => tx`
      update conversation_turns
      set rating = 'down', rating_note = 'It missed the bill', rated_at = now()
      where id = ${replyA}`);
    const [row] = await admin<{ rating: string; rating_note: string }[]>`
      select rating, rating_note from conversation_turns where id = ${replyA}`;
    expect(row).toEqual({ rating: 'down', rating_note: 'It missed the bill' });

    const theirs = await asUser(userB, (tx) => tx`select id from conversation_turns`);
    expect(theirs).toHaveLength(0);
    await asUser(userB, async (tx) => {
      const updated = await tx`update conversation_turns set rating = 'up', rated_at = now() where id = ${replyA}`;
      expect(updated.count).toBe(0);
    });
    const [after] = await admin<{ rating: string }[]>`
      select rating from conversation_turns where id = ${replyA}`;
    expect(after.rating).toBe('down');
  });

  it('refuses a rating on their own turn, an unknown rating, a missing time or a long note', async () => {
    await expect(admin`update conversation_turns set rating = 'up', rated_at = now() where id = ${askA}`).rejects.toThrow();
    await expect(admin`update conversation_turns set rating = 'meh', rated_at = now() where id = ${replyA}`).rejects.toThrow();
    await expect(admin`update conversation_turns set rating = 'up', rated_at = null where id = ${replyA}`).rejects.toThrow();
    await expect(admin`update conversation_turns set rating = null where id = ${replyA}`).rejects.toThrow();
    await expect(
      admin`update conversation_turns set rating_note = ${'x'.repeat(1001)} where id = ${replyA}`,
    ).rejects.toThrow();
    await expect(admin`update conversation_turns set rating_note = 'x' where id = ${askA}`).rejects.toThrow();
  });

  it('can be taken back', async () => {
    await asUser(userA, (tx) => tx`
      update conversation_turns set rating = null, rating_note = null, rated_at = null where id = ${replyA}`);
    const [row] = await admin<{ rating: string | null }[]>`
      select rating from conversation_turns where id = ${replyA}`;
    expect(row.rating).toBeNull();
  });
});

describe('the weekly reply check', () => {
  it('is one row per account per Monday, read and written only by its owner', async () => {
    const flagged = JSON.stringify([
      { turn_id: replyA, conversation_id: CONVERSATION, kind: 'pushed_back', quote: 'No, I meant the bill' },
    ]);
    await asUser(userA, (tx) => tx`
      insert into ask_reply_checks (user_id, week, model, flagged)
      values (${userA}, '2026-10-12', 'haiku', ${flagged}::text::jsonb)`);

    expect(await asUser(userA, (tx) => tx`select id from ask_reply_checks`)).toHaveLength(1);
    expect(await asUser(userB, (tx) => tx`select id from ask_reply_checks`)).toHaveLength(0);

    await expect(
      admin`insert into ask_reply_checks (user_id, week, model) values (${userA}, '2026-10-12', 'haiku')`,
    ).rejects.toThrow();
    await expect(
      asUser(userB, (tx) => tx`
        insert into ask_reply_checks (user_id, week, model) values (${userA}, '2026-10-19', 'haiku')`),
    ).rejects.toThrow(/row-level security/);
    await expect(
      admin`insert into ask_reply_checks (user_id, week, model) values (${userA}, '2026-10-13', 'haiku')`,
    ).rejects.toThrow();
    await expect(
      admin`insert into ask_reply_checks (user_id, week, model, flagged) values (${userA}, '2026-10-19', 'haiku', '{}'::jsonb)`,
    ).rejects.toThrow();
  });
});
