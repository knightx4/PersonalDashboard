/**
 * Test database helpers for the job search schema.
 *
 * The commerce side has its own (./db), against the same database. Two apps
 * share this one, each owning a schema, so which helper a test imports is what
 * decides which app's tables its unqualified names resolve to.
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

/** The schema this app owns. Everything below is scoped to it. */
export const APP_SCHEMA = 'job_search';

export const sql = postgres(TEST_DATABASE_URL, {
  max: 4,
  onnotice: () => {},
  // Unqualified table names in the tests resolve into job_search, the way they
  // do for the app. `public` stays on the path so a coexistence test can see
  // the commerce app's tables sitting beside ours.
  connection: { search_path: `${APP_SCHEMA}, public, extensions` },
});

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
    // `set local role` does not touch search_path, but being explicit here means
    // the assertions do not depend on the connection option above surviving a
    // driver upgrade.
    await tx.unsafe(`set local search_path = ${APP_SCHEMA}, public, extensions`);
    await tx.unsafe(`set local request.jwt.claims = '${JSON.stringify({ sub: userId, role: 'authenticated' })}'`);
    return fn(tx);
  }) as Promise<T>;
}

/**
 * Run a callback as `anon` -- a visitor with no session at all.
 *
 * The public case page is the only thing in this app that a stranger can read,
 * so its assertions have to run as the role a stranger actually gets. `asUser`
 * would grant `authenticated`, which is a different and more privileged thing.
 */
export async function asAnon<T>(fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx.unsafe(`set local role anon`);
    await tx.unsafe(`set local search_path = ${APP_SCHEMA}, public, extensions`);
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

/**
 * Remove all test users and everything cascading from them.
 *
 * Every table in this schema hangs off auth.users, directly or through a
 * parent, so one delete is genuinely enough -- and if that ever stops being
 * true, the isolation test's coverage check is what will notice.
 */
export async function truncateAll(): Promise<void> {
  await admin`delete from auth.users`;
}

export async function closeDb(): Promise<void> {
  await sql.end({ timeout: 5 });
}
