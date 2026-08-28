/**
 * Two apps, one database, one schema each.
 *
 * The job search side owns `job_search` and the commerce side owns `public`,
 * because Supabase bills per project rather than per app -- and because their
 * `public` schemas collide outright on four table names, six enum types and
 * two function names. That only holds if the migrations genuinely stay inside
 * their own schema, and the two ways it could quietly stop holding are:
 *
 *   - an unqualified `create table` in a future migration landing in `public`
 *   - a `create or replace function` overwriting the other app's, which does
 *     NOT error the way a duplicate table or enum does
 *
 * These assertions used to need a fixture standing in for the neighbour, since
 * the two apps lived in separate repositories. They no longer do: both
 * migration sets are applied by db-reset, so every run is the real thing. The
 * detection below is kept because a run that checked nothing must say so
 * rather than pass vacuously.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, APP_SCHEMA, closeDb, truncateAll } from './helpers/db-jobs';

/**
 * Detected with a top-level await, NOT in beforeAll.
 *
 * `it.runIf(...)` is evaluated while the file is being collected, which happens
 * before any hook runs — so a flag set in beforeAll is always false and every
 * assertion below silently skips. Which is exactly what happened the first time
 * this file was written.
 */
const neighbourPresent = await (async () => {
  const [row] = await admin<{ present: boolean }[]>`
    select exists (
      select 1 from pg_tables where schemaname = 'public' and tablename = 'profiles'
    ) as present`;
  return row.present;
})();

beforeAll(async () => {
  await truncateAll();
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

describe('coexistence with the commerce app in public', () => {
  it('reports whether the neighbour is present', () => {
    if (!neighbourPresent) {
      console.warn(
        '[coexistence] no app found in `public` — these assertions did not run. ' +
          'db:reset applies both migration sets; run it before the suite.',
      );
    }
    // Not an assertion about the schema; an assertion that the reader of a
    // green run can tell which of the two modes it was.
    expect(typeof neighbourPresent).toBe('boolean');
  });

  it.runIf(neighbourPresent)(
    'keeps both message_classification enums, with their own values',
    async () => {
      const rows = await admin<{ nspname: string; labels: number }[]>`
        select n.nspname, count(e.enumlabel)::int as labels
        from pg_type t
        join pg_namespace n on n.oid = t.typnamespace
        join pg_enum e on e.enumtypid = t.oid
        where t.typname = 'message_classification'
        group by 1 order by 1`;
      // Eleven recruiting labels here, six commerce labels next door. Same
      // type name, incompatible values — the collision that forced the split.
      expect(rows).toEqual([
        { nspname: 'job_search', labels: 11 },
        { nspname: 'public', labels: 6 },
      ]);
    },
  );

  it.runIf(neighbourPresent)('does not overwrite the neighbour functions', async () => {
    for (const fn of ['handle_new_user', 'touch_updated_at']) {
      const rows = await admin<{ nspname: string }[]>`
        select n.nspname from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where p.proname = ${fn} order by 1`;
      expect(rows.map((r) => r.nspname), fn).toEqual([APP_SCHEMA, 'public']);
    }
  });

  it.runIf(neighbourPresent)('takes its own trigger name on the shared auth.users', async () => {
    const rows = await admin<{ tgname: string }[]>`
      select t.tgname from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'auth' and c.relname = 'users' and not t.tgisinternal
      order by 1`;
    expect(rows.map((r) => r.tgname)).toEqual([
      'on_auth_user_created',
      'on_auth_user_created_job_search',
    ]);
  });

  it.runIf(neighbourPresent)('gives one signup a profile in each app', async () => {
    // The point of sharing auth.users: one login, and each app seeds its own
    // profile row without knowing the other exists.
    await admin`insert into auth.users (email) values ('shared@example.com')`;

    const [ours] = await admin<{ count: number }[]>`
      select count(*)::int from job_search.profiles p
      join auth.users u on u.id = p.id where u.email = 'shared@example.com'`;
    const [theirs] = await admin<{ count: number }[]>`
      select count(*)::int from public.profiles p
      join auth.users u on u.id = p.id where u.email = 'shared@example.com'`;

    expect(ours.count).toBe(1);
    expect(theirs.count).toBe(1);
  });

  it.runIf(neighbourPresent)('cascades a deleted account out of both apps', async () => {
    const [user] = await admin<{ id: string }[]>`
      insert into auth.users (email) values ('leaving@example.com') returning id`;

    const before = await profileCounts(user.id);
    expect(before).toEqual({ ours: 1, theirs: 1 });

    await admin`delete from auth.users where id = ${user.id}`;

    // Scoped to this user rather than counting rows in the table: another test
    // in this file leaves an account behind, and a total would make this pass
    // or fail depending on execution order.
    expect(await profileCounts(user.id)).toEqual({ ours: 0, theirs: 0 });
  });
});

async function profileCounts(userId: string): Promise<{ ours: number; theirs: number }> {
  const [ours] = await admin<{ count: number }[]>`
    select count(*)::int from job_search.profiles where id = ${userId}`;
  const [theirs] = await admin<{ count: number }[]>`
    select count(*)::int from public.profiles where id = ${userId}`;
  return { ours: ours.count, theirs: theirs.count };
}

