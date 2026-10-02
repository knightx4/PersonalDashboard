/**
 * Requests Ask Dash handed to the backup routine (plan #1402), against the
 * database.
 *
 * Done when a person can read and write only their own hand-offs, and a
 * hand-off cannot hang from somebody else's conversation.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asUser, closeDb, createUser, truncateAll } from './helpers/db-core';

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
});
