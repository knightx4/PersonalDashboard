/**
 * Test database helpers.
 *
 * Tests connect as the `postgres` superuser, which bypasses RLS entirely, so
 * anything asserting on policy behaviour must go through `asUser()`. That sets
 * `role authenticated` and the `request.jwt.claims` GUC for the duration of one
 * transaction -- the same two things PostgREST sets per request in production,
 * which is what makes these assertions mean something.
 */
import postgres from 'postgres';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://postgres@localhost:5433/shopping_manager_test';

export const sql = postgres(TEST_DATABASE_URL, { max: 4, onnotice: () => {} });

/** Privileged connection: bypasses RLS. Use only for setup and teardown. */
export const admin = sql;

/**
 * Run a callback inside a transaction acting as `authenticated` with the given
 * user id as the JWT subject, then roll back nothing -- commits normally.
 */
export async function asUser<T>(
  userId: string,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx.unsafe(`set local role authenticated`);
    await tx.unsafe(`set local request.jwt.claims = '${JSON.stringify({ sub: userId, role: 'authenticated' })}'`);
    return fn(tx);
  }) as Promise<T>;
}

/**
 * Run a callback as `anon` -- no session, no JWT claims. This is the role a
 * visitor with a share link actually has, and the only thing it may usefully
 * reach is the two functions in 0041.
 */
export async function asAnon<T>(
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx.unsafe(`set local role anon`);
    await tx.unsafe(`set local search_path = public, extensions`);
    return fn(tx);
  }) as Promise<T>;
}

/** Create an auth.users row (and, via trigger, its profile). */
export async function createUser(email: string): Promise<string> {
  const [row] = await admin<{ id: string }[]>`
    insert into auth.users (email) values (${email}) returning id
  `;
  return row.id;
}

/** Remove all test users and everything cascading from them. */
export async function truncateAll(): Promise<void> {
  await admin`delete from auth.users`;
  // user-scoped merchants cascade with their creator; global seed rows stay
  await admin`delete from merchants where not is_global`;
  await admin`delete from fx_rates`;
  // Reference data, keyed by ISBN or BGG id rather than by user, so it does not
  // cascade out with the accounts. Left behind, a second run against the same
  // database trips the unique (isbn, source) / (bgg_id, source) key during
  // seeding.
  await admin`delete from book_price_quotes`;
  await admin`delete from game_price_quotes`;
}

export async function closeDb(): Promise<void> {
  await sql.end({ timeout: 5 });
}
