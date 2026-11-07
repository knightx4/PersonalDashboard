/**
 * A browser task's wait for the person's PC or Mac (plan #3040.4), against
 * the database.
 *
 * Done when a claim whose computer has gone quiet for 5 minutes is let go so
 * the cloud session takes it, a claim whose computer is still sending its
 * heartbeat is kept however long the task takes, another account's rows are
 * left alone, and the line saying a cloud session started lands in the
 * thread the task was asked in, as Dash or as the bot that handed it on.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { admin, closeDb, createUser, truncateAll } from './helpers/db-core';

let owner = '';
let other = '';
let ask = '';
let otherAsk = '';
let zena = '';
let direct = '';
let group = '';

const avatar = (seed: string) => admin.json({ style: 'notionists', seed });

async function conversation(user: string): Promise<string> {
  const [c] = await admin<{ id: string }[]>`
    with fresh as (select gen_random_uuid() as id)
    insert into core.conversations (id, user_id, subject_kind, subject_ref, title)
    select id, ${user}, 'ask', id::text, 'Browser task' from fresh returning id`;
  return c.id;
}

async function askTask(user: string, conv: string): Promise<string> {
  const [row] = await admin<{ id: string }[]>`
    insert into core.dash_handoffs (user_id, kind, conversation_id, request, asked, request_key, browser_task, created_at)
    values (${user}, 'session', ${conv}, 'Check the gym hours', 'check the gym hours',
            gen_random_uuid()::text, true, now() - interval '20 minutes')
    returning id`;
  return row.id;
}

async function chatTask(chat: string): Promise<string> {
  const [row] = await admin<{ id: string }[]>`
    insert into core.dash_handoffs (user_id, kind, advisor_chat_id, advisor_id, request, asked, request_key, browser_task)
    values (${owner}, 'session', ${chat}, ${zena}, 'Check the gym hours', 'check the gym hours',
            gen_random_uuid()::text, true)
    returning id`;
  return row.id;
}

const claimedAgo = (id: string, machine: string, minutes: number) => admin`
  update core.dash_handoffs set claimed_by = ${machine}, claimed_at = now() - make_interval(mins => ${minutes})
  where id = ${id}`;

const seen = (machine: string, user: string, minutes: number) => admin`
  insert into core.browser_runners (machine, user_id, last_seen_at)
  values (${machine}, ${user}, now() - make_interval(mins => ${minutes}))
  on conflict (machine) do update set last_seen_at = excluded.last_seen_at, user_id = excluded.user_id`;

const claimOf = async (id: string) => {
  const [row] = await admin<{ claimed_by: string | null; claimed: boolean }[]>`
    select claimed_by, claimed_at is not null as claimed from core.dash_handoffs where id = ${id}`;
  return row;
};

const release = async (): Promise<number> => {
  const [row] = await admin<{ n: number }[]>`select core.release_stale_browser_claims() as n`;
  return row.n;
};

beforeAll(async () => {
  await truncateAll();
  owner = await createUser('browser-wait-owner@example.com');
  other = await createUser('browser-wait-other@example.com');
  await admin`
    insert into core.app_settings (singleton, owner_user_id) values (true, ${owner})
    on conflict (singleton) do update set owner_user_id = excluded.owner_user_id`;
  ask = await conversation(owner);
  otherAsk = await conversation(other);
  const [z] = await admin<{ id: string }[]>`
    insert into you.board_advisors (user_id, key, name, kind, question, avatar)
    values (${owner}, 'zena', 'Zena the Researcher', 'seat', 'What is known?', ${avatar('zena')}) returning id`;
  zena = z.id;
  const [d] = await admin<{ id: string }[]>`
    insert into you.advisor_chats (user_id, advisor_id, title) values (${owner}, ${zena}, 'Gym') returning id`;
  direct = d.id;
  const [g] = await admin<{ id: string }[]>`
    insert into you.advisor_chats (user_id, kind, advisor_id) values (${owner}, 'group', null) returning id`;
  group = g.id;
});

beforeEach(async () => {
  await admin`delete from core.dash_handoffs`;
  await admin`delete from core.browser_runners`;
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

describe('letting go of a quiet claim', () => {
  it('lets go of a task claimed over 5 minutes ago by a computer silent for 5 minutes', async () => {
    const id = await askTask(owner, ask);
    await claimedAgo(id, 'pc', 8);
    await seen('pc', owner, 6);

    expect(await release()).toBe(1);
    expect(await claimOf(id)).toEqual({ claimed_by: null, claimed: false });
  });

  it('lets go when the claiming computer never sent a heartbeat', async () => {
    const id = await askTask(owner, ask);
    await claimedAgo(id, 'mac', 6);
    expect(await release()).toBe(1);
    expect((await claimOf(id)).claimed_by).toBeNull();
  });

  it('keeps a long task while its computer is still sending its heartbeat', async () => {
    const id = await askTask(owner, ask);
    await claimedAgo(id, 'pc', 30);
    await seen('pc', owner, 1);
    expect(await release()).toBe(0);
    expect((await claimOf(id)).claimed_by).toBe('pc');
  });

  it('keeps a claim made in the last 5 minutes, and judges each claim by its own computer', async () => {
    const recent = await askTask(owner, ask);
    await claimedAgo(recent, 'mac', 2);
    const byPc = await askTask(owner, ask);
    await claimedAgo(byPc, 'pc', 10);
    // The Mac is live, the PC is not: only the PC's claim goes.
    await seen('mac', owner, 0);
    await seen('pc', owner, 9);

    expect(await release()).toBe(1);
    expect((await claimOf(recent)).claimed_by).toBe('mac');
    expect((await claimOf(byPc)).claimed_by).toBeNull();
  });

  it('leaves another account and a task no longer pending alone', async () => {
    const others = await askTask(other, otherAsk);
    await claimedAgo(others, 'pc', 30);
    const done = await askTask(owner, ask);
    await claimedAgo(done, 'pc', 30);
    await admin`update core.dash_handoffs set status = 'done' where id = ${done}`;

    expect(await release()).toBe(0);
    expect((await claimOf(others)).claimed_by).toBe('pc');
    expect((await claimOf(done)).claimed_by).toBe('pc');
  });
});

describe('saying in the thread that the cloud took it', () => {
  it("posts Dash's turn in an Ask Dash conversation", async () => {
    const id = await askTask(owner, ask);
    const [said] = await admin<{ id: string | null }[]>`select core.say_in_handoff_thread(${id}, 'Started in the cloud.') as id`;
    const [turn] = await admin<{ role: string; body: string; conversation_id: string }[]>`
      select role, body, conversation_id from core.conversation_turns where id = ${said.id}`;
    expect(turn).toEqual({ role: 'assistant', body: 'Started in the cloud.', conversation_id: ask });
  });

  it('posts as the bot in a one-on-one chat, and as its speaker in a group', async () => {
    const one = await chatTask(direct);
    const many = await chatTask(group);
    const [a] = await admin<{ id: string }[]>`select core.say_in_handoff_thread(${one}, 'Started in the cloud.') as id`;
    const [b] = await admin<{ id: string }[]>`select core.say_in_handoff_thread(${many}, 'Started in the cloud.') as id`;
    const rows = await admin<{ id: string; chat_id: string; role: string; speaker_id: string | null; text: string }[]>`
      select id, chat_id, role, speaker_id, text from you.advisor_messages where id in (${a.id}, ${b.id})`;
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(a.id)).toMatchObject({ chat_id: direct, role: 'advisor', speaker_id: null, text: 'Started in the cloud.' });
    expect(byId.get(b.id)).toMatchObject({ chat_id: group, role: 'advisor', speaker_id: zena });
  });

  it("says nothing in another account's thread", async () => {
    const id = await askTask(other, otherAsk);
    const [said] = await admin<{ id: string | null }[]>`select core.say_in_handoff_thread(${id}, 'Started in the cloud.') as id`;
    expect(said.id).toBeNull();
    const [count] = await admin<{ n: number }[]>`
      select count(*)::int as n from core.conversation_turns where conversation_id = ${otherAsk}`;
    expect(count.n).toBe(0);
  });
});
