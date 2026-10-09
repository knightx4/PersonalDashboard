/**
 * Personal capture tokens (plan #1705), against the database.
 *
 * Done when the stored row holds only a hash, the person can make, list and
 * revoke only their own tokens and never read a hash back, a revoked token is
 * refused, and the rate limit refuses a burst and lets the token back in once
 * its window has passed.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asUser, closeDb, createUser, sql, truncateAll } from './helpers/db-core';
import { hashCaptureToken, makeCaptureToken } from '@/lib/capture/tokens';

let me = '';
let them = '';

type Use = { outcome: string; user_id: string | null; token_id: string | null; retry_at: Date | null };

/** core.use_capture_token as the capture route runs it: as the service role. */
async function use(hash: string, perMinute = 3, perDay = 5, now?: Date): Promise<Use> {
  return sql.begin(async (tx) => {
    await tx.unsafe('set local role service_role');
    const [row] = await tx<Use[]>`
      select * from core.use_capture_token(${hash}, ${perMinute}, ${perDay}, ${now ?? new Date()})`;
    return row;
  }) as Promise<Use>;
}

async function make(userId: string, label: string): Promise<{ id: string; token: string; hash: string }> {
  const { token, hash } = makeCaptureToken();
  const [row] = await asUser(
    userId,
    (tx) => tx<{ id: string }[]>`
      insert into capture_tokens (user_id, label, token_hash)
      values (${userId}, ${label}, ${hash})
      returning id`,
  );
  return { id: row.id, token, hash };
}

beforeAll(async () => {
  await truncateAll();
  me = await createUser('capture-tokens-a@example.com');
  them = await createUser('capture-tokens-b@example.com');
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

describe('a capture token', () => {
  it('is stored as its hash only, and the hash cannot be read back from the page', async () => {
    const { id, token, hash } = await make(me, 'iPhone Shortcut');
    const [row] = await admin<Record<string, unknown>[]>`select * from capture_tokens where id = ${id}`;
    expect(row.token_hash).toBe(hash);
    expect(Object.values(row)).not.toContain(token);

    const listed = await asUser(me, (tx) => tx`select id, label, created_at, last_used_at, revoked_at from capture_tokens`);
    expect(listed).toHaveLength(1);
    await expect(asUser(me, (tx) => tx`select token_hash from capture_tokens`)).rejects.toThrow();
  });

  it('is seen and revoked only by its owner, and cannot be made already used or for someone else', async () => {
    const { id } = await make(me, 'Revoke me');
    expect(await asUser(them, (tx) => tx`select id from capture_tokens`)).toHaveLength(0);

    const [theirs] = await asUser(them, (tx) => tx<{ r: Date | null }[]>`select core.revoke_capture_token(${id}) as r`);
    expect(theirs.r).toBeNull();

    await expect(
      asUser(them, (tx) => tx`insert into capture_tokens (user_id, label, token_hash)
        values (${me}, 'Sneaky', ${makeCaptureToken().hash})`),
    ).rejects.toThrow();
    await expect(
      asUser(me, (tx) => tx`insert into capture_tokens (user_id, label, token_hash) values (${me}, 'Plain', 'abc')`),
    ).rejects.toThrow();
    await expect(
      asUser(me, (tx) => tx`update capture_tokens set revoked_at = null where id = ${id}`),
    ).rejects.toThrow();
  });

  it('lets a capture through and records when, and refuses an unknown hash', async () => {
    const { id, token } = await make(me, 'Fresh');
    const ok = await use(hashCaptureToken(token));
    expect(ok).toMatchObject({ outcome: 'ok', user_id: me, token_id: id });
    const [row] = await admin<{ last_used_at: Date | null }[]>`select last_used_at from capture_tokens where id = ${id}`;
    expect(row.last_used_at).not.toBeNull();

    const unknown = await use(makeCaptureToken().hash);
    expect(unknown).toMatchObject({ outcome: 'unknown', user_id: null, token_id: null });
  });

  it('is refused once revoked, and stays revoked', async () => {
    const { id, hash } = await make(me, 'Lost phone');
    expect((await use(hash)).outcome).toBe('ok');

    const [first] = await asUser(me, (tx) => tx<{ r: Date }[]>`select core.revoke_capture_token(${id}) as r`);
    const [again] = await asUser(me, (tx) => tx<{ r: Date }[]>`select core.revoke_capture_token(${id}) as r`);
    expect(again.r.getTime()).toBe(first.r.getTime());

    expect(await use(hash)).toMatchObject({ outcome: 'revoked', user_id: null });
  });

  it('refuses a burst past the minute limit until the minute has passed', async () => {
    const { hash } = await make(me, 'Burst');
    const start = new Date('2026-10-09T12:00:00Z');
    const at = (seconds: number) => new Date(start.getTime() + seconds * 1000);

    for (const s of [0, 1, 2]) expect((await use(hash, 3, 100, at(s))).outcome).toBe('ok');
    const refused = await use(hash, 3, 100, at(3));
    expect(refused.outcome).toBe('limited');
    expect(refused.retry_at?.toISOString()).toBe(at(60).toISOString());

    // A refused capture is not counted, so the token is back once the minute is up.
    expect((await use(hash, 3, 100, at(60))).outcome).toBe('ok');
  });

  it('refuses past the day limit until the day has passed', async () => {
    const { hash } = await make(me, 'Daily');
    const start = new Date('2026-10-09T08:00:00Z');
    const at = (minutes: number) => new Date(start.getTime() + minutes * 60_000);

    for (const m of [0, 2, 4]) expect((await use(hash, 10, 3, at(m))).outcome).toBe('ok');
    const refused = await use(hash, 10, 3, at(6));
    expect(refused.outcome).toBe('limited');
    expect(refused.retry_at?.toISOString()).toBe(at(24 * 60).toISOString());
    expect((await use(hash, 10, 3, at(24 * 60))).outcome).toBe('ok');
  });

  it('cannot be checked by a signed-in person, only by the service role', async () => {
    const { hash } = await make(me, 'Route only');
    await expect(
      asUser(me, (tx) => tx`select * from core.use_capture_token(${hash}, 3, 5)`),
    ).rejects.toThrow();
  });
});
