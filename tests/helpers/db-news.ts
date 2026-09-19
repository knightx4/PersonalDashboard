/**
 * Test database helpers for the news schema.
 *
 * A sixth helper for a sixth schema, on the same database. Which one a test
 * imports decides whose tables its unqualified names resolve to.
 */
import postgres from 'postgres';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://postgres@localhost:5433/shopping_manager_test';

export const NEWS_SCHEMA = 'news';

export const sql = postgres(TEST_DATABASE_URL, {
  max: 4,
  onnotice: () => {},
  connection: { search_path: `${NEWS_SCHEMA}, public, extensions` },
});

/** Privileged connection: bypasses RLS. Use only for setup and teardown. */
export const admin = sql;

export async function asUser<T>(
  userId: string,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx.unsafe(`set local role authenticated`);
    await tx.unsafe(`set local search_path = ${NEWS_SCHEMA}, public, extensions`);
    await tx.unsafe(
      `set local request.jwt.claims = '${JSON.stringify({ sub: userId, role: 'authenticated' })}'`,
    );
    return fn(tx);
  }) as Promise<T>;
}

export async function createUser(email: string): Promise<string> {
  const [row] = await admin<{ id: string }[]>`
    insert into auth.users (email) values (${email}) returning id
  `;
  return row.id;
}

/** Everything in news hangs off auth.users. */
export async function truncateAll(): Promise<void> {
  await admin`delete from auth.users`;
}

export async function closeDb(): Promise<void> {
  await sql.end({ timeout: 5 });
}
