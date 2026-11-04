/**
 * Test database helpers for the finances schema (plan #2593.2), on the same
 * database as the other schemas' helpers. Unqualified names resolve to
 * finances first.
 */
import postgres from 'postgres';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://postgres@localhost:5433/shopping_manager_test';

export const FINANCES_SCHEMA = 'finances';

export const sql = postgres(TEST_DATABASE_URL, {
  max: 4,
  onnotice: () => {},
  connection: { search_path: `${FINANCES_SCHEMA}, public, extensions` },
});

/** Privileged connection: bypasses RLS. Use only for setup and teardown. */
export const admin = sql;

export async function asUser<T>(
  userId: string,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx.unsafe(`set local role authenticated`);
    await tx.unsafe(`set local search_path = ${FINANCES_SCHEMA}, public, extensions`);
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

/** Everything in finances hangs off auth.users. */
export async function truncateAll(): Promise<void> {
  await admin`delete from auth.users`;
}

export async function closeDb(): Promise<void> {
  await sql.end({ timeout: 5 });
}
