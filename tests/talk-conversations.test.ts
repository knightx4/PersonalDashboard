/**
 * A saved conversation about a card (plan #1053), against the database.
 *
 * Done when a conversation started on a card can be closed mid-way and
 * reopened with every turn in place, and another account cannot read it. The
 * writes here are the ones lib/talk/store.ts makes through PostgREST: start
 * the conversation if it is not there, add turns, read them back in order.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { admin, asUser, closeDb, createUser, truncateAll } from './helpers/db-core';

let userA = '';
let userB = '';
const CARD = '6f1c1f5e-0000-4000-8000-000000000001';

/** appendTurns, as the person: start it without replacing one, then add turns. */
async function append(
  tx: postgres.TransactionSql,
  userId: string,
  ref: string,
  turns: { role: string; body: string }[],
): Promise<void> {
  await tx`
    insert into conversations (user_id, subject_kind, subject_ref, title)
    values (${userId}, 'feed_card', ${ref}, 'AlphaGo')
    on conflict (user_id, subject_kind, subject_ref) do nothing`;
  const [conversation] = await tx<{ id: string }[]>`
    select id from conversations where subject_kind = 'feed_card' and subject_ref = ${ref}`;
  for (const turn of turns) {
    await tx`
      insert into conversation_turns (conversation_id, user_id, role, body)
      values (${conversation.id}, ${userId}, ${turn.role}, ${turn.body})`;
  }
}

/** loadConversation, as the person. */
async function load(userId: string, ref: string): Promise<{ role: string; body: string }[]> {
  return asUser(
    userId,
    (tx) => tx<{ role: string; body: string }[]>`
      select t.role, t.body
      from conversations c join conversation_turns t on t.conversation_id = c.id
      where c.subject_kind = 'feed_card' and c.subject_ref = ${ref}
      order by t.created_at`,
  );
}

beforeAll(async () => {
  await truncateAll();
  userA = await createUser('talk-a@example.com');
  userB = await createUser('talk-b@example.com');
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

describe('a conversation about a card', () => {
  it('keeps every turn across sittings, in order, in one conversation', async () => {
    // First sitting: a question and its reply, then the tab is closed.
    await asUser(userA, (tx) =>
      append(tx, userA, CARD, [
        { role: 'user', body: 'Why does a tree search beat brute force here?' },
        { role: 'assistant', body: 'It only searches the moves the network rates.' },
      ]),
    );
    // Second sitting: a question whose reply never came.
    await asUser(userA, (tx) => append(tx, userA, CARD, [{ role: 'user', body: 'And the value network?' }]));

    expect(await load(userA, CARD)).toEqual([
      { role: 'user', body: 'Why does a tree search beat brute force here?' },
      { role: 'assistant', body: 'It only searches the moves the network rates.' },
      { role: 'user', body: 'And the value network?' },
    ]);
    const [{ count }] = await admin<{ count: number }[]>`
      select count(*)::int as count from conversations where user_id = ${userA}`;
    expect(count).toBe(1);
  });

  it('keeps a question and its reply in the order given when written in one statement', async () => {
    const ref = 'one-statement';
    await asUser(userA, async (tx) => {
      await tx`
        insert into conversations (user_id, subject_kind, subject_ref)
        values (${userA}, 'feed_card', ${ref})`;
      await tx`
        insert into conversation_turns (conversation_id, user_id, role, body)
        select c.id, ${userA}, v.role, v.body
        from conversations c,
             (values (1, 'user', 'First'), (2, 'assistant', 'Second'), (3, 'user', 'Third')) as v(n, role, body)
        where c.subject_ref = ${ref}
        order by v.n`;
    });
    expect((await load(userA, ref)).map((turn) => turn.body)).toEqual(['First', 'Second', 'Third']);
  });

  it('refuses a blank turn, an unknown role and an unknown kind', async () => {
    await expect(asUser(userA, (tx) => append(tx, userA, CARD, [{ role: 'user', body: '   ' }]))).rejects.toThrow();
    await expect(asUser(userA, (tx) => append(tx, userA, CARD, [{ role: 'system', body: 'Hi' }]))).rejects.toThrow();
    await expect(
      asUser(
        userA,
        (tx) => tx`insert into conversations (user_id, subject_kind, subject_ref) values (${userA}, 'email', 'x')`,
      ),
    ).rejects.toThrow();
  });
});

describe('another account', () => {
  it('cannot read the conversation or its turns', async () => {
    expect(await load(userB, CARD)).toEqual([]);
    const conversations = await asUser(userB, (tx) => tx`select id from conversations`);
    const turns = await asUser(userB, (tx) => tx`select id from conversation_turns`);
    expect(conversations).toHaveLength(0);
    expect(turns).toHaveLength(0);
  });

  it('cannot add a turn to it, under either account', async () => {
    const [conversation] = await admin<{ id: string }[]>`
      select id from conversations where user_id = ${userA} and subject_ref = ${CARD}`;

    // As themselves: the composite key has no conversation of theirs by that id.
    await expect(
      asUser(
        userB,
        (tx) => tx`
          insert into conversation_turns (conversation_id, user_id, role, body)
          values (${conversation.id}, ${userB}, 'user', 'Mine now')`,
      ),
    ).rejects.toThrow();
    // As the owner: RLS refuses the row.
    await expect(
      asUser(
        userB,
        (tx) => tx`
          insert into conversation_turns (conversation_id, user_id, role, body)
          values (${conversation.id}, ${userA}, 'user', 'Mine now')`,
      ),
    ).rejects.toThrow();
  });

  it('cannot change or delete it', async () => {
    const edited = await asUser(
      userB,
      (tx) => tx`update conversation_turns set body = 'Rewritten' returning id`,
    );
    const deleted = await asUser(userB, (tx) => tx`delete from conversations returning id`);
    expect(edited).toHaveLength(0);
    expect(deleted).toHaveLength(0);
    expect(await load(userA, CARD)).toHaveLength(3);
  });

  it('keeps its own conversation about the same card apart', async () => {
    await asUser(userB, (tx) => append(tx, userB, CARD, [{ role: 'user', body: 'My own question' }]));
    expect(await load(userB, CARD)).toEqual([{ role: 'user', body: 'My own question' }]);
    expect(await load(userA, CARD)).toHaveLength(3);
  });
});

describe('deleting', () => {
  it('takes the turns with the conversation', async () => {
    await asUser(userA, (tx) => tx`delete from conversations where subject_ref = ${CARD}`);
    const [{ count }] = await admin<{ count: number }[]>`
      select count(*)::int as count from conversation_turns where user_id = ${userA}
        and conversation_id not in (select id from conversations)`;
    expect(count).toBe(0);
    expect(await load(userA, CARD)).toEqual([]);
  });
});
