/**
 * Hand-offs from one bot to another (plan #3003.1), against the database.
 *
 * Done when the same dedupe_key inserted twice yields one row, and a person
 * reads and writes only their own hand-offs.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asUser, closeDb, createUser, truncateAll } from './helpers/db-core';

let userA = '';
let userB = '';
const ZENA = '6f1c1f5e-0000-4000-8000-0000000000a1';
const BOB = '6f1c1f5e-0000-4000-8000-0000000000a2';
const CHAT = '6f1c1f5e-0000-4000-8000-0000000000c1';
const KEY = `direct:${CHAT}>${BOB}#abc`;

beforeAll(async () => {
  await truncateAll();
  userA = await createUser('bot-handoffs-a@example.com');
  userB = await createUser('bot-handoffs-b@example.com');
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

describe('a bot-to-bot hand-off', () => {
  it('is kept as sent with its packet, and read back only by its owner', async () => {
    const [row] = await asUser(
      userA,
      (tx) => tx<{ id: string; status: string; packet: unknown }[]>`
        insert into core.bot_handoffs (user_id, from_bot, to_bot, source_kind, source_id, source_link, request, packet, dedupe_key)
        values (${userA}, ${ZENA}, ${BOB}, 'direct', ${CHAT}, '/chat/people/zena', 'tell Bob to build it this way',
                ${tx.json({ summary: 'Fish Audio against ElevenLabs.' })}, ${KEY})
        returning id, status, packet`,
    );
    expect(row.status).toBe('sent');
    expect(row.packet).toEqual({ summary: 'Fish Audio against ElevenLabs.' });
    expect(await asUser(userB, (tx) => tx`select id from core.bot_handoffs`)).toHaveLength(0);
    expect(await asUser(userA, (tx) => tx`select id from core.bot_handoffs`)).toHaveLength(1);
  });

  it('keeps one row when the same request comes twice', async () => {
    const again = await asUser(
      userA,
      (tx) => tx`
        insert into core.bot_handoffs (user_id, from_bot, to_bot, source_kind, source_id, source_link, request, dedupe_key)
        values (${userA}, ${ZENA}, ${BOB}, 'direct', ${CHAT}, '/chat/people/zena', 'Tell Bob to build it this way.', ${KEY})
        on conflict (user_id, dedupe_key) do nothing
        returning id`,
    );
    expect(again).toHaveLength(0);
    await expect(
      admin`insert into core.bot_handoffs (user_id, to_bot, source_kind, source_id, source_link, request, dedupe_key)
            values (${userA}, ${BOB}, 'direct', ${CHAT}, '/chat/people/zena', 'again', ${KEY})`,
    ).rejects.toThrow();
    const rows = await admin`select id from core.bot_handoffs where dedupe_key = ${KEY}`;
    expect(rows).toHaveLength(1);
  });

  it('ends done only with when, and keeps the row it made', async () => {
    await expect(admin`update core.bot_handoffs set status = 'done' where dedupe_key = ${KEY}`).rejects.toThrow();
    const [done] = await admin<{ status: string; result_table: string }[]>`
      update core.bot_handoffs
         set status = 'done', done_at = now(), result = 'Added #3010', result_table = 'public.plan_items', result_id = 'p1'
       where dedupe_key = ${KEY}
       returning status, result_table`;
    expect(done).toEqual({ status: 'done', result_table: 'public.plan_items' });
  });

  it('refuses a bot handing to itself, an unknown status and another account', async () => {
    await expect(
      admin`insert into core.bot_handoffs (user_id, from_bot, to_bot, source_kind, source_id, source_link, request, dedupe_key)
            values (${userA}, ${BOB}, ${BOB}, 'direct', ${CHAT}, '/chat/people/bob', 'x', 'k-self')`,
    ).rejects.toThrow();
    await expect(
      admin`insert into core.bot_handoffs (user_id, to_bot, source_kind, source_id, source_link, request, status, dedupe_key)
            values (${userA}, ${BOB}, 'direct', ${CHAT}, '/chat/people/zena', 'x', 'lost', 'k-status')`,
    ).rejects.toThrow();
    await expect(
      asUser(
        userB,
        (tx) => tx`
          insert into core.bot_handoffs (user_id, to_bot, source_kind, source_id, source_link, request, dedupe_key)
          values (${userA}, ${BOB}, 'direct', ${CHAT}, '/chat/people/zena', 'x', 'k-other')`,
      ),
    ).rejects.toThrow();
  });
});
