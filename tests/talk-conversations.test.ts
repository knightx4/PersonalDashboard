/**
 * A saved conversation under a row (plans #1053, #1468), against the database.
 *
 * Done when a conversation started under a row can be closed mid-way and
 * reopened with every turn in place, and another account cannot read it or
 * start one under that row. The writes here are the ones lib/talk/store.ts
 * makes through PostgREST: start the conversation if it is not there, add
 * turns, read them back in order. The row here is a todo task; that a thread
 * can sit under a row of every registry table is tests/refs.test.ts's.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { admin, asUser, closeDb, createUser, truncateAll } from './helpers/db-core';

let userA = '';
let userB = '';
/** A row thread's ref: a todo task of userA's, and one of userB's. */
let CARD = '';
let OTHER = '';
let CARD_B = '';
const ASK = '6f1c1f5e-0000-4000-8000-0000000000a5';

/** appendTurns, as the person: start it without replacing one, then add turns. */
async function append(
  tx: postgres.TransactionSql,
  userId: string,
  ref: string,
  turns: { role: string; body: string }[],
  kind = 'row',
): Promise<void> {
  // An ask conversation's id is its ref, and appendTurns sends it with the ref.
  await tx`
    insert into conversations (id, user_id, subject_kind, subject_ref, title)
    values (coalesce(${kind === 'ask' ? ref : null}::uuid, gen_random_uuid()), ${userId}, ${kind}, ${ref}, 'AlphaGo')
    on conflict (user_id, subject_kind, subject_ref) do nothing`;
  const [conversation] = await tx<{ id: string }[]>`
    select id from conversations where subject_kind = ${kind} and subject_ref = ${ref}`;
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
      where c.subject_kind = 'row' and c.subject_ref = ${ref}
      order by t.created_at`,
  );
}

beforeAll(async () => {
  await truncateAll();
  userA = await createUser('talk-a@example.com');
  userB = await createUser('talk-b@example.com');
  const task = async (userId: string, title: string) => {
    const [row] = await admin<{ id: string }[]>`
      insert into todo.tasks (user_id, title) values (${userId}, ${title}) returning id`;
    return `todo.tasks:${row.id}`;
  };
  CARD = await task(userA, 'Read the AlphaGo paper');
  OTHER = await task(userA, 'Write it up');
  CARD_B = await task(userB, 'Their own task');
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

describe('a conversation under a row', () => {
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
    const ref = OTHER;
    await asUser(userA, async (tx) => {
      await tx`
        insert into conversations (user_id, subject_kind, subject_ref)
        values (${userA}, 'row', ${ref})`;
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

  it('refuses a ref that is not schema.table:id, a row that is gone, and the old kinds', async () => {
    for (const ref of ['card-1', 'todo.tasks:00000000-0000-4000-8000-000000000000']) {
      await expect(
        asUser(userA, (tx) => tx`insert into conversations (user_id, subject_kind, subject_ref) values (${userA}, 'row', ${ref})`),
        ref,
      ).rejects.toThrow();
    }
    for (const kind of ['feed_card', 'news_story']) {
      await expect(
        asUser(userA, (tx) => tx`insert into conversations (user_id, subject_kind, subject_ref) values (${userA}, ${kind}, ${CARD})`),
        kind,
      ).rejects.toThrow();
    }
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

  it('cannot start a thread under the other account\'s row', async () => {
    await expect(
      asUser(userB, (tx) => append(tx, userB, CARD, [{ role: 'user', body: 'My own question' }])),
    ).rejects.toThrow(/is not a row of yours/);
    // Nor can a run on the service role put one there for them.
    await expect(
      admin`insert into core.conversations (user_id, subject_kind, subject_ref) values (${userB}, 'row', ${CARD})`,
    ).rejects.toThrow(/is not a row of yours/);
    expect(await load(userA, CARD)).toHaveLength(3);
  });

  it('keeps its own threads under its own rows', async () => {
    await asUser(userB, (tx) => append(tx, userB, CARD_B, [{ role: 'user', body: 'My own question' }]));
    expect(await load(userB, CARD_B)).toEqual([{ role: 'user', body: 'My own question' }]);
  });

  it('cannot move a thread under the other account\'s row', async () => {
    await expect(
      asUser(userB, (tx) => tx`update conversations set subject_ref = ${CARD} where subject_ref = ${CARD_B}`),
    ).rejects.toThrow(/is not a row of yours/);
  });
});

describe('a question asked from anywhere', () => {
  it('starts under its own id, takes turns with what Dash looked up and cited, and reads back', async () => {
    const citation = { table: 'todo.tasks', ref: 'k1', title: 'Call Acme', href: '/todo?task=k1' };
    const id = await asUser(userA, async (tx) => {
      const [started] = await tx<{ id: string }[]>`
        insert into conversations (id, user_id, subject_kind, subject_ref, title)
        values (${ASK}, ${userA}, 'ask', ${ASK}, 'What is overdue?')
        returning id`;
      await tx`
        insert into conversation_turns (conversation_id, user_id, role, body)
        values (${started.id}, ${userA}, 'user', 'What is overdue?')`;
      await tx`
        insert into conversation_turns (conversation_id, user_id, role, body, tool_calls, citations)
        values (${started.id}, ${userA}, 'assistant', 'Calling Acme.',
                ${tx.json([{ name: 'totals', input: { of: 'todos' }, result: [citation] }])},
                ${tx.json([citation])})`;
      return started.id;
    });
    // Picked up later: one more question in the same conversation.
    await asUser(userA, (tx) => append(tx, userA, id, [{ role: 'user', body: 'And tomorrow?' }], 'ask'));

    const turns = await asUser(
      userA,
      (tx) => tx<{ role: string; body: string; citations: unknown }[]>`
        select t.role, t.body, t.citations
        from conversations c join conversation_turns t on t.conversation_id = c.id
        where c.subject_kind = 'ask' and c.subject_ref = ${id}
        order by t.created_at`,
    );
    expect(turns).toEqual([
      { role: 'user', body: 'What is overdue?', citations: null },
      { role: 'assistant', body: 'Calling Acme.', citations: [citation] },
      { role: 'user', body: 'And tomorrow?', citations: null },
    ]);
    expect(await asUser(userB, (tx) => tx`select id from conversations where subject_kind = 'ask'`)).toHaveLength(0);
  });

  it('refuses a ref other than its own id, and citations on the person\'s turn', async () => {
    await expect(
      asUser(
        userA,
        (tx) => tx`
          insert into conversations (user_id, subject_kind, subject_ref) values (${userA}, 'ask', 'something-else')`,
      ),
    ).rejects.toThrow();
    const [conversation] = await admin<{ id: string }[]>`
      select id from conversations where user_id = ${userA} and subject_kind = 'ask'`;
    await expect(
      asUser(
        userA,
        (tx) => tx`
          insert into conversation_turns (conversation_id, user_id, role, body, citations)
          values (${conversation.id}, ${userA}, 'user', 'Mine', ${tx.json([])})`,
      ),
    ).rejects.toThrow();
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
