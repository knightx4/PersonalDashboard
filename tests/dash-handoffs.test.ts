/**
 * Requests Ask Dash handed to the backup routine (plan #1402), against the
 * database.
 *
 * Done when a person can read and write only their own hand-offs, and a
 * hand-off cannot hang from somebody else's conversation.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asUser, closeDb, createUser, truncateAll } from './helpers/db-core';
import {
  CLOSE_SQL,
  closeParameters,
  SEEN_SQL,
  SPEND_SQL,
  spendParameter,
  transcriptSpend,
} from '@/lib/talk/handoff-session';

let userA = '';
let userB = '';
const CONVERSATION = '6f1c1f5e-0000-4000-8000-0000000000d0';

beforeAll(async () => {
  await truncateAll();
  userA = await createUser('handoffs-a@example.com');
  userB = await createUser('handoffs-b@example.com');
  await admin`
    insert into conversations (id, user_id, subject_kind, subject_ref, title)
    values (${CONVERSATION}, ${userA}, 'ask', ${CONVERSATION}, 'Add a goal')`;
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

describe('a hand-off', () => {
  it('is kept as pending by its owner and read back only by them', async () => {
    const [row] = await asUser(
      userA,
      (tx) => tx<{ id: string; status: string }[]>`
        insert into dash_handoffs (user_id, conversation_id, request)
        values (${userA}, ${CONVERSATION}, 'Create a goal "Publish a song"')
        returning id, status`,
    );
    expect(row.status).toBe('pending');

    const mine = await asUser(userA, (tx) => tx`select id from dash_handoffs`);
    const theirs = await asUser(userB, (tx) => tx`select id from dash_handoffs`);
    expect(mine).toHaveLength(1);
    expect(theirs).toHaveLength(0);

    await asUser(userA, (tx) => tx`update dash_handoffs set status = 'fired', run_id = 'cse_1' where id = ${row.id}`);
    const [after] = await admin<{ status: string }[]>`select status from dash_handoffs where id = ${row.id}`;
    expect(after.status).toBe('fired');
  });

  it('cannot be written in somebody else\'s conversation, or with a blank request or unknown status', async () => {
    await expect(
      asUser(userB, (tx) => tx`
        insert into dash_handoffs (user_id, conversation_id, request)
        values (${userB}, ${CONVERSATION}, 'Something')`),
    ).rejects.toThrow();
    await expect(
      admin`insert into dash_handoffs (user_id, conversation_id, request) values (${userA}, ${CONVERSATION}, '  ')`,
    ).rejects.toThrow();
    await expect(
      admin`insert into dash_handoffs (user_id, conversation_id, request, status)
            values (${userA}, ${CONVERSATION}, 'x', 'sent')`,
    ).rejects.toThrow();
  });

  it('names the row it is about as a ref, or nothing (plan #1568)', async () => {
    const [row] = await admin<{ subject_ref: string | null }[]>`
      insert into dash_handoffs (user_id, conversation_id, request, subject_ref)
      values (${userA}, ${CONVERSATION}, 'Split it in two', 'todo.tasks:t1')
      returning subject_ref`;
    expect(row.subject_ref).toBe('todo.tasks:t1');
    await expect(
      admin`insert into dash_handoffs (user_id, conversation_id, request, subject_ref)
            values (${userA}, ${CONVERSATION}, 'x', 'not a ref')`,
    ).rejects.toThrow();
  });
});

describe('a session hand-off (plan #3005.1)', () => {
  const KEY = `core.conversations:${CONVERSATION}#m1`;

  it('keeps the words, summary and refs, and reads its state from status', async () => {
    const [row] = await asUser(
      userA,
      (tx) => tx<{ id: string; state: string; refs: unknown }[]>`
        insert into dash_handoffs (user_id, kind, conversation_id, request, asked, summary, refs, request_key)
        values (${userA}, 'session', ${CONVERSATION}, 'Write #3001 in full', 'flesh out 3001',
                'Planning hand-offs.', ${tx.json([{ ref: 'public.plan_items:abc' }])}, ${KEY})
        returning id, state, refs`,
    );
    expect(row.state).toBe('queued');
    expect(row.refs).toEqual([{ ref: 'public.plan_items:abc' }]);
    await admin`update dash_handoffs set status = 'fired', cost_micros = 120000, last_seen_at = now() where id = ${row.id}`;
    const [after] = await admin<{ state: string }[]>`select state from dash_handoffs where id = ${row.id}`;
    expect(after.state).toBe('running');
  });

  it('keeps one row for a retried request with the same key', async () => {
    const again = await asUser(
      userA,
      (tx) => tx`
        insert into dash_handoffs (user_id, kind, conversation_id, request, asked, request_key)
        values (${userA}, 'session', ${CONVERSATION}, 'Write #3001 in full', 'flesh out 3001', ${KEY})
        on conflict (user_id, request_key) do nothing
        returning id`,
    );
    expect(again).toHaveLength(0);
    const rows = await admin`select id from dash_handoffs where request_key = ${KEY}`;
    expect(rows).toHaveLength(1);
  });

  it('needs a key, the words and one thread', async () => {
    await expect(
      admin`insert into dash_handoffs (user_id, kind, conversation_id, request, asked)
            values (${userA}, 'session', ${CONVERSATION}, 'x', 'x')`,
    ).rejects.toThrow();
    await expect(
      admin`insert into dash_handoffs (user_id, kind, conversation_id, request, request_key)
            values (${userA}, 'session', ${CONVERSATION}, 'x', 'k-no-words')`,
    ).rejects.toThrow();
    await expect(
      admin`insert into dash_handoffs (user_id, kind, request, asked, request_key)
            values (${userA}, 'session', 'x', 'x', 'k-no-thread')`,
    ).rejects.toThrow();
  });
});

describe('a session working its hand-off (plan #3005.3)', () => {
  const spend = transcriptSpend([
    JSON.stringify({
      type: 'assistant',
      message: { id: 'msg_1', model: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: 100 } },
    }),
  ]);

  async function queued(key: string): Promise<string> {
    const [row] = await admin<{ id: string }[]>`
      insert into dash_handoffs (user_id, kind, conversation_id, request, asked, request_key)
      values (${userA}, 'session', ${CONVERSATION}, 'Write #3001 in full', 'flesh out 3001', ${key})
      returning id`;
    return row.id;
  }

  it("moves a queued hand-off to running when it reports, and only the owner's", async () => {
    const id = await queued('k-seen');
    expect(await admin.unsafe(SEEN_SQL, [id, userB])).toHaveLength(0);
    const [seen] = await admin.unsafe(SEEN_SQL, [id, userA]);
    expect(seen.state).toBe('running');
    const [row] = await admin`select fired_at, last_seen_at from dash_handoffs where id = ${id}`;
    expect(row.fired_at).not.toBeNull();
    expect(row.last_seen_at).not.toBeNull();
  });

  it('closes done with its cost once, and counts that cost toward spend', async () => {
    const id = await queued('k-close');
    await admin.unsafe(SEEN_SQL, [id, userA]);
    const [closed] = await admin.unsafe(CLOSE_SQL, closeParameters(id, userA, { outcome: 'done' }, spend) as never[]);
    expect(closed.state).toBe('done');
    expect(Number(closed.cost_micros)).toBe(spend[0].costMicros);
    const rows = await admin.unsafe(SPEND_SQL, [userA, spendParameter(spend)]);
    expect(rows).toHaveLength(1);
    const [ledger] = await admin`
      select module, operation, model, output_tokens, cost_micros from model_spend where id = ${rows[0].id}`;
    expect(ledger).toMatchObject({
      module: 'core',
      operation: 'hand-off-session',
      model: 'claude-opus-5-5',
      output_tokens: 100,
    });

    const again = await admin.unsafe(
      CLOSE_SQL,
      closeParameters(id, userA, { outcome: 'failed', reason: 'late' }, spend) as never[],
    );
    expect(again).toHaveLength(0);
  });

  it('closes failed with the reason', async () => {
    const id = await queued('k-fail');
    const [closed] = await admin.unsafe(
      CLOSE_SQL,
      closeParameters(id, userA, { outcome: 'failed', reason: 'The table was not found.' }, []) as never[],
    );
    expect(closed.state).toBe('failed');
    expect(closed.cost_micros).toBeNull();
    const [row] = await admin`select error, finished_at from dash_handoffs where id = ${id}`;
    expect(row.error).toBe('The table was not found.');
    expect(row.finished_at).not.toBeNull();
  });
});
