/**
 * The bot hand-off watch (plan #3003.4), against the database.
 *
 * Done when a hand-off left unanswered 10 minutes is dropped and flagged in
 * its source thread as the sending bot, a failed one is flagged with its
 * error, neither is flagged twice, another account's rows are left alone,
 * and Resend puts the same row back to sent without a second one.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asUser, closeDb, createUser, truncateAll } from './helpers/db-core';

let owner = '';
let other = '';
let zena = '';
let bob = '';
let direct = '';
let group = '';
let ask = '';

const avatar = (seed: string) => admin.json({ style: 'notionists', seed });

async function handoff(
  user: string,
  fields: { kind: 'ask' | 'direct' | 'group'; source: string; from: string | null; to: string | null; key: string; request?: string },
): Promise<string> {
  const [row] = await admin<{ id: string }[]>`
    insert into core.bot_handoffs (user_id, from_bot, to_bot, source_kind, source_id, source_link, request, dedupe_key)
    values (${user}, ${fields.from}, ${fields.to}, ${fields.kind}, ${fields.source}, '/chat/people/zena',
            ${fields.request ?? 'tell Bob to build it this way'}, ${fields.key})
    returning id`;
  return row.id;
}

const ageBy = (id: string, minutes: number) =>
  admin`update core.bot_handoffs set sent_at = now() - make_interval(mins => ${minutes}) where id = ${id}`;

beforeAll(async () => {
  await truncateAll();
  owner = await createUser('bot-watch-owner@example.com');
  other = await createUser('bot-watch-other@example.com');
  await admin`
    insert into core.app_settings (singleton, owner_user_id) values (true, ${owner})
    on conflict (singleton) do update set owner_user_id = excluded.owner_user_id`;
  const [z] = await admin<{ id: string }[]>`
    insert into you.board_advisors (user_id, key, name, kind, question, avatar)
    values (${owner}, 'zena', 'Zena the Researcher', 'seat', 'What is known?', ${avatar('zena')}) returning id`;
  const [b] = await admin<{ id: string }[]>`
    insert into you.board_advisors (user_id, key, name, kind, question, avatar)
    values (${owner}, 'bob', 'Bob Builder', 'seat', 'What do we build?', ${avatar('bob')}) returning id`;
  zena = z.id;
  bob = b.id;
  const [d] = await admin<{ id: string }[]>`
    insert into you.advisor_chats (user_id, advisor_id, title) values (${owner}, ${zena}, 'Voice') returning id`;
  direct = d.id;
  const [g] = await admin<{ id: string }[]>`
    insert into you.advisor_chats (user_id, kind, advisor_id) values (${owner}, 'group', null) returning id`;
  group = g.id;
  const [c] = await admin<{ id: string }[]>`
    with fresh as (select gen_random_uuid() as id)
    insert into core.conversations (id, user_id, subject_kind, subject_ref, title)
    select id, ${owner}, 'ask', id::text, 'Voice chat' from fresh returning id`;
  ask = c.id;
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

describe('the bot hand-off watch', () => {
  it('drops one not picked up in 10 minutes and flags it in the source thread as the sender', async () => {
    const id = await handoff(owner, { kind: 'direct', source: direct, from: zena, to: bob, key: 'k-timeout' });
    const fresh = await handoff(owner, { kind: 'direct', source: direct, from: zena, to: bob, key: 'k-fresh' });
    await ageBy(id, 11);
    await ageBy(fresh, 5);

    await admin`select core.watch_bot_handoffs()`;

    const [row] = await admin<{ status: string; error: string; flagged: boolean; done: boolean }[]>`
      select status, error, flagged_at is not null as flagged, done_at is not null as done
      from core.bot_handoffs where id = ${id}`;
    expect(row).toEqual({ status: 'dropped', error: 'Not picked up within 10 minutes.', flagged: true, done: true });
    const [kept] = await admin<{ status: string }[]>`select status from core.bot_handoffs where id = ${fresh}`;
    expect(kept.status).toBe('sent');

    const said = await admin<{ text: string; speaker_id: string | null; receipts: { link: string }[] }[]>`
      select text, speaker_id, receipts from you.advisor_messages where chat_id = ${direct}`;
    expect(said).toHaveLength(1);
    expect(said[0].text).toMatch(/^Bob hasn't picked up what I passed on after 10 minutes: “tell Bob to build it this way”\./);
    expect(said[0].text).toMatch(/send it again from Dev home\.$/);
    expect(said[0].speaker_id).toBeNull();
    expect(said[0].receipts[0].link).toBe('/dev/raised#bot-handoffs');
  });

  it('flags a picked-up one that never finished without offering to send it again', async () => {
    const id = await handoff(owner, { kind: 'group', source: group, from: zena, to: bob, key: 'k-stuck' });
    await admin`update core.bot_handoffs set status = 'picked_up', picked_up_at = now() - interval '12 minutes',
                sent_at = now() - interval '12 minutes' where id = ${id}`;

    await admin`select core.watch_bot_handoffs()`;

    const [row] = await admin<{ status: string }[]>`select status from core.bot_handoffs where id = ${id}`;
    expect(row.status).toBe('dropped');
    const [said] = await admin<{ text: string; speaker_id: string | null; receipts: unknown[] }[]>`
      select text, speaker_id, receipts from you.advisor_messages where chat_id = ${group}`;
    expect(said.text).toMatch(/^Bob started on what I passed on but hadn't finished/);
    expect(said.text).not.toMatch(/Dev home/);
    expect(said.speaker_id).toBe(zena);
    expect(said.receipts).toEqual([]);
    // Picked up, so the receiver may have acted: Resend refuses it.
    const back = await asUser(owner, (tx) => tx<{ id: string | null }[]>`select core.resend_bot_handoff(${id}) as id`);
    expect(back[0].id).toBeNull();
  });

  it('flags a failed one with its error, once', async () => {
    const id = await handoff(owner, { kind: 'ask', source: ask, from: null, to: bob, key: 'k-failed' });
    await admin`update core.bot_handoffs set status = 'failed', done_at = now(),
                error = 'Bob Builder cannot talk until their brain is built' where id = ${id}`;

    await admin`select core.watch_bot_handoffs()`;
    await admin`select core.watch_bot_handoffs()`;

    const turns = await admin<{ role: string; body: string }[]>`
      select role, body from core.conversation_turns where conversation_id = ${ask}`;
    expect(turns).toHaveLength(1);
    expect(turns[0].role).toBe('assistant');
    expect(turns[0].body).toBe(
      'Bob couldn\'t take on what I passed on: “tell Bob to build it this way”. Bob Builder cannot talk until their brain is built. You can send it again from Dev home.',
    );
    const direct1 = await admin`select id from you.advisor_messages where chat_id = ${direct}`;
    expect(direct1).toHaveLength(1);
  });

  it('leaves an old failure and another account alone', async () => {
    const old = await handoff(owner, { kind: 'direct', source: direct, from: zena, to: bob, key: 'k-old' });
    await admin`update core.bot_handoffs set status = 'failed', done_at = now() - interval '3 days', error = 'x' where id = ${old}`;
    const theirs = await handoff(other, { kind: 'direct', source: direct, from: null, to: bob, key: 'k-theirs' });
    await ageBy(theirs, 30);

    await admin`select core.watch_bot_handoffs()`;

    const rows = await admin<{ id: string; status: string; flagged_at: string | null }[]>`
      select id, status, flagged_at from core.bot_handoffs where id in (${old}, ${theirs})`;
    expect(rows.find((r) => r.id === old)?.flagged_at).toBeNull();
    expect(rows.find((r) => r.id === theirs)).toMatchObject({ status: 'sent', flagged_at: null });
  });

  it('resends the same row once, and drops it again 10 minutes after the resend', async () => {
    const [row] = await admin<{ id: string }[]>`select id from core.bot_handoffs where dedupe_key = 'k-timeout'`;
    const first = await asUser(owner, (tx) => tx<{ id: string | null }[]>`select core.resend_bot_handoff(${row.id}) as id`);
    expect(first[0].id).toBe(row.id);
    const again = await asUser(owner, (tx) => tx<{ id: string | null }[]>`select core.resend_bot_handoff(${row.id}) as id`);
    expect(again[0].id).toBeNull();
    const stranger = await asUser(other, (tx) => tx<{ id: string | null }[]>`select core.resend_bot_handoff(${row.id}) as id`);
    expect(stranger[0].id).toBeNull();

    const [back] = await admin<{ status: string; error: string | null; flagged_at: string | null; n: number }[]>`
      select status, error, flagged_at, (select count(*)::int from core.bot_handoffs where dedupe_key = 'k-timeout') as n
      from core.bot_handoffs where id = ${row.id}`;
    expect(back).toEqual({ status: 'sent', error: null, flagged_at: null, n: 1 });

    // Sent 11 minutes ago but resent just now: still waiting.
    await admin`select core.watch_bot_handoffs()`;
    const [waiting] = await admin<{ status: string }[]>`select status from core.bot_handoffs where id = ${row.id}`;
    expect(waiting.status).toBe('sent');

    await admin`update core.bot_handoffs set resent_at = now() - interval '11 minutes' where id = ${row.id}`;
    await admin`select core.watch_bot_handoffs()`;
    const [dropped] = await admin<{ status: string; flagged: boolean }[]>`
      select status, flagged_at is not null as flagged from core.bot_handoffs where id = ${row.id}`;
    expect(dropped).toEqual({ status: 'dropped', flagged: true });
  });

  it('flags a hand-off to Ask Dash, which fails straight away, and refuses to resend it', async () => {
    const id = await handoff(owner, { kind: 'group', source: group, from: zena, to: null, key: 'k-ask-dash' });
    await admin`update core.bot_handoffs set status = 'failed', done_at = now(),
                error = 'Ask Dash does not take requests from the bots yet.' where id = ${id}`;

    await admin`select core.watch_bot_handoffs()`;

    const said = await admin<{ text: string }[]>`
      select text from you.advisor_messages where chat_id = ${group} order by created_at desc limit 1`;
    expect(said[0].text).toBe(
      'Dash couldn\'t take on what I passed on: “tell Bob to build it this way”. Ask Dash does not take requests from the bots yet.',
    );
    const back = await asUser(owner, (tx) => tx<{ id: string | null }[]>`select core.resend_bot_handoff(${id}) as id`);
    expect(back[0].id).toBeNull();
  });
});
