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
  TELL_DONE_SQL,
  TELL_FAILED_SQL,
  transcriptSpend,
  UNDO_RECEIPT,
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

describe('a session hand-off telling its thread (plan #3005.4)', () => {
  let advisor = '';
  let group = '';
  let direct = '';

  beforeAll(async () => {
    const [made] = await admin<{ id: string }[]>`
      insert into you.board_advisors (user_id, key, name, kind, question, avatar)
      values (${userA}, 'gert', 'Gert', 'seat', 'What next?', ${admin.json({ style: 'notionists', seed: 'gert' })})
      returning id`;
    advisor = made.id;
    const [g] = await admin<{ id: string }[]>`
      insert into you.advisor_chats (user_id, kind, advisor_id) values (${userA}, 'group', null) returning id`;
    group = g.id;
    const [d] = await admin<{ id: string }[]>`
      insert into you.advisor_chats (user_id, advisor_id, title) values (${userA}, ${advisor}, 'Plans') returning id`;
    direct = d.id;
  });

  /** A People session hand-off, then the update that sets where it stands. */
  async function people(key: string, chat: string, set = "status = 'fired'"): Promise<string> {
    const [row] = await admin<{ id: string }[]>`
      insert into dash_handoffs (user_id, kind, advisor_id, advisor_chat_id, request, asked, request_key)
      values (${userA}, 'session', ${advisor}, ${chat}, 'Write the prep doc', 'prep me for Friday', ${key})
      returning id`;
    await admin.unsafe(`update core.dash_handoffs set ${set} where id = $1`, [row.id]);
    return row.id;
  }

  async function messages(chat: string) {
    return admin<{ text: string; speaker_id: string | null; receipts: unknown }[]>`
      select text, speaker_id, receipts from you.advisor_messages where chat_id = ${chat} order by created_at`;
  }

  it('posts a finished result in a group as the bot, with its links and Undo, once', async () => {
    const id = await people('p-done', group);
    await admin.unsafe(CLOSE_SQL, closeParameters(id, userA, { outcome: 'done' }, []) as never[]);
    const receipts = [{ label: 'Prep doc', link: '/vault/n/Prep.md' }, UNDO_RECEIPT];
    const [told] = await admin.unsafe(TELL_DONE_SQL, [id, userA, 'Here is your prep doc.', JSON.stringify(receipts)]);
    expect(told.message_id).not.toBeNull();
    // Not twice, and never from another account.
    const [again] = await admin.unsafe(TELL_DONE_SQL, [id, userA, 'Again.', '[]']);
    expect(again.message_id).toBeNull();
    const [theirs] = await admin.unsafe(TELL_DONE_SQL, [id, userB, 'Theirs.', '[]']);
    expect(theirs.message_id).toBeNull();

    const posted = await messages(group);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ text: 'Here is your prep doc.', speaker_id: advisor, receipts });
    const [row] = await admin`select told_at from dash_handoffs where id = ${id}`;
    expect(row.told_at).not.toBeNull();
  });

  it('says a failure with its reason in the chat', async () => {
    const id = await people('p-fail', direct);
    await admin.unsafe(
      CLOSE_SQL,
      closeParameters(id, userA, { outcome: 'failed', reason: 'The folder was not there' }, []) as never[],
    );
    await admin.unsafe(TELL_FAILED_SQL, [id]);
    const posted = await messages(direct);
    expect(posted.at(-1)?.text).toBe(
      "That didn't work, sorry. The folder was not there. Ask me again and I'll have another go.",
    );
    expect(posted.at(-1)?.speaker_id).toBeNull();
  });

  it('flags one quiet for 20 minutes once, and fails and tells one quiet for 90', async () => {
    const quiet = await people(
      'p-quiet',
      direct,
      "status = 'fired', fired_at = now() - interval '40 minutes', last_seen_at = now() - interval '25 minutes'",
    );
    const reporting = await people(
      'p-busy',
      direct,
      "status = 'fired', fired_at = now() - interval '60 minutes', last_seen_at = now() - interval '5 minutes'",
    );
    const gone = await people('p-gone', direct, "status = 'fired', fired_at = now() - interval '95 minutes'");
    const before = (await messages(direct)).length;

    await admin`select you.watch_bot_pages()`;
    await admin`select you.watch_bot_pages()`;

    const rows = await admin<{ id: string; status: string; nudged_at: Date | null; told_at: Date | null }[]>`
      select id, status, nudged_at, told_at from dash_handoffs where id in ${admin([quiet, reporting, gone])}`;
    const by = new Map(rows.map((row) => [row.id, row]));
    expect(by.get(quiet)?.nudged_at).not.toBeNull();
    expect(by.get(quiet)?.status).toBe('fired');
    expect(by.get(reporting)?.nudged_at).toBeNull();
    expect(by.get(gone)?.status).toBe('failed');
    expect(by.get(gone)?.told_at).not.toBeNull();

    const posted = (await messages(direct)).slice(before).map((m) => m.text);
    expect(posted).toHaveLength(2);
    expect(posted.some((text) => text.startsWith('This is taking longer than it should'))).toBe(true);
    expect(posted.some((text) => text.includes('Nothing came back for 90 minutes'))).toBe(true);
  });

  it('reports one closed done with nothing posted, pointing at its Undo', async () => {
    const id = await people('p-unsaid', direct, "status = 'done', finished_at = now() - interval '15 minutes'");
    await admin`select you.watch_bot_pages()`;
    const last = (await messages(direct)).at(-1);
    expect(last?.text).toMatch(/^That's finished, but no write-up/);
    expect(last?.receipts).toEqual([{ label: 'What Dash did today', link: '/home#dash-today' }]);
    const [row] = await admin`select told_at from dash_handoffs where id = ${id}`;
    expect(row.told_at).not.toBeNull();
  });

  it('tells an Ask Dash conversation as Dash, unless the session wrote its own reply', async () => {
    const [failed] = await admin<{ id: string }[]>`
      insert into dash_handoffs (user_id, kind, conversation_id, request, asked, request_key, status, error)
      values (${userA}, 'session', ${CONVERSATION}, 'x', 'x', 'a-fail', 'failed', 'The step was not found')
      returning id`;
    await admin.unsafe(TELL_FAILED_SQL, [failed.id]);
    const [turn] = await admin`
      select role, body from conversation_turns where conversation_id = ${CONVERSATION} order by created_at desc limit 1`;
    expect(turn.role).toBe('assistant');
    expect(turn.body).toContain('The step was not found.');

    const [replied] = await admin<{ id: string }[]>`
      insert into dash_handoffs (user_id, kind, conversation_id, request, asked, request_key, status)
      values (${userA}, 'session', ${CONVERSATION}, 'x', 'x', 'a-replied', 'fired') returning id`;
    const [reply] = await admin<{ id: string }[]>`
      insert into conversation_turns (conversation_id, user_id, role, body)
      values (${CONVERSATION}, ${userA}, 'assistant', 'Done: I wrote it.') returning id`;
    const [closed] = await admin.unsafe(
      CLOSE_SQL,
      closeParameters(replied.id, userA, { outcome: 'done', replyTurnId: reply.id }, []) as never[],
    );
    expect(closed.told_at).not.toBeNull();
  });
});
