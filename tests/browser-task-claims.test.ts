/**
 * Browser tasks claimed by the person's PC or Mac (plan #3040.5), against
 * the database.
 *
 * Done when the PC can claim any pending browser task, the Mac claims only
 * when the PC has sent no heartbeat in the last 2 minutes, and two claims on
 * one task cannot both win.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { admin, closeDb, createUser, truncateAll } from './helpers/db-core';

let owner = '';
let other = '';
let ownerChat = '';
let otherChat = '';

async function chat(user: string): Promise<string> {
  const [c] = await admin<{ id: string }[]>`
    with fresh as (select gen_random_uuid() as id)
    insert into core.conversations (id, user_id, subject_kind, subject_ref, title)
    select id, ${user}, 'ask', id::text, 'Browser task' from fresh returning id`;
  return c.id;
}

async function task(user: string, conversation: string, minutesAgo: number, browser = true): Promise<string> {
  const [row] = await admin<{ id: string }[]>`
    insert into core.dash_handoffs (user_id, kind, conversation_id, request, asked, request_key, browser_task, created_at)
    values (${user}, 'session', ${conversation}, 'Fill in the form', 'fill in the form',
            gen_random_uuid()::text, ${browser}, now() - make_interval(mins => ${minutesAgo}))
    returning id`;
  return row.id;
}

const claim = async (machine: string): Promise<string | null> => {
  const [row] = await admin<{ id: string | null }[]>`select core.claim_browser_task(${machine}) as id`;
  return row.id;
};

const pcSeen = (secondsAgo: number) => admin`
  insert into core.browser_runners (machine, user_id, last_seen_at)
  values ('pc', ${owner}, now() - make_interval(secs => ${secondsAgo}))
  on conflict (machine) do update set last_seen_at = excluded.last_seen_at`;

beforeAll(async () => {
  await truncateAll();
  owner = await createUser('browser-claims-owner@example.com');
  other = await createUser('browser-claims-other@example.com');
  await admin`
    insert into core.app_settings (singleton, owner_user_id) values (true, ${owner})
    on conflict (singleton) do update set owner_user_id = excluded.owner_user_id`;
  ownerChat = await chat(owner);
  otherChat = await chat(other);
});

beforeEach(async () => {
  await admin`delete from core.dash_handoffs`;
  await admin`delete from core.browser_runners`;
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

describe('claiming a browser task', () => {
  it('lets the PC claim the oldest pending one, even while the PC is live', async () => {
    await pcSeen(5);
    const newer = await task(owner, ownerChat, 1);
    const older = await task(owner, ownerChat, 5);
    await task(owner, ownerChat, 10, false);
    await task(other, otherChat, 20);

    expect(await claim('pc')).toBe(older);
    const [row] = await admin<{ claimed_by: string; claimed: boolean }[]>`
      select claimed_by, claimed_at is not null as claimed from core.dash_handoffs where id = ${older}`;
    expect(row).toEqual({ claimed_by: 'pc', claimed: true });

    expect(await claim('pc')).toBe(newer);
    // Neither the task that needs no browser nor another account's is taken.
    expect(await claim('pc')).toBeNull();
  });

  it('lets the Mac claim when the PC has never sent a heartbeat or has been silent over 2 minutes', async () => {
    const first = await task(owner, ownerChat, 2);
    const second = await task(owner, ownerChat, 1);
    expect(await claim('mac')).toBe(first);

    await pcSeen(150);
    expect(await claim('mac')).toBe(second);
    const [row] = await admin<{ claimed_by: string }[]>`select claimed_by from core.dash_handoffs where id = ${second}`;
    expect(row.claimed_by).toBe('mac');
  });

  it('refuses the Mac while the PC has sent a heartbeat in the last 2 minutes', async () => {
    const id = await task(owner, ownerChat, 1);
    await admin`select core.browser_runner_heartbeat('pc')`;
    expect(await claim('mac')).toBeNull();
    const [row] = await admin<{ claimed_by: string | null }[]>`select claimed_by from core.dash_handoffs where id = ${id}`;
    expect(row.claimed_by).toBeNull();
    expect(await claim('pc')).toBe(id);
  });

  it('gives one task to only one of two claims made at once', async () => {
    const id = await task(owner, ownerChat, 1);
    const results = await Promise.all([claim('pc'), claim('mac'), claim('pc')]);
    expect(results.filter((r) => r === id)).toHaveLength(1);
    expect(results.filter((r) => r === null)).toHaveLength(2);
    // Once taken, it is not taken again.
    expect(await claim('pc')).toBeNull();
  });

  it('does not claim one that is no longer pending, and refuses an unknown machine', async () => {
    const id = await task(owner, ownerChat, 1);
    await admin`update core.dash_handoffs set status = 'fired' where id = ${id}`;
    expect(await claim('pc')).toBeNull();
    await expect(claim('laptop')).rejects.toThrow();
  });
});

describe('the runner heartbeat', () => {
  it('keeps one row per machine for the owner, moving its last_seen_at forward', async () => {
    await pcSeen(600);
    await admin`select core.browser_runner_heartbeat('pc')`;
    await admin`select core.browser_runner_heartbeat('mac')`;
    const rows = await admin<{ machine: string; user_id: string; fresh: boolean }[]>`
      select machine, user_id, last_seen_at > now() - interval '10 seconds' as fresh
        from core.browser_runners order by machine`;
    expect(rows).toEqual([
      { machine: 'mac', user_id: owner, fresh: true },
      { machine: 'pc', user_id: owner, fresh: true },
    ]);
    await expect(admin`select core.browser_runner_heartbeat('tablet')`).rejects.toThrow();
  });
});
