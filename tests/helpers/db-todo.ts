/**
 * Test database helpers for the todo schema.
 *
 * A fifth helper for a fifth schema, on the same database. Which one a test
 * imports decides whose tables its unqualified names resolve to.
 *
 * The search_path here carries every schema the todo tables point into, because
 * this module's whole distinguishing feature is that its foreign keys cross
 * schemas -- a test that has to write a role before it can link to one needs
 * `job_search` in scope to do it.
 */
import postgres from 'postgres';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://postgres@localhost:5433/shopping_manager_test';

export const TODO_SCHEMA = 'todo';

const SEARCH_PATH = `${TODO_SCHEMA}, public, extensions`;

export const sql = postgres(TEST_DATABASE_URL, {
  max: 4,
  onnotice: () => {},
  connection: { search_path: SEARCH_PATH },
});

/** Privileged connection: bypasses RLS. Use only for setup and teardown. */
export const admin = sql;

export async function asUser<T>(
  userId: string,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx.unsafe(`set local role authenticated`);
    await tx.unsafe(`set local search_path = ${SEARCH_PATH}`);
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

/**
 * A role belonging to someone, for the link tests.
 *
 * Roles hang off a company, which hangs off the user, so the pair is created
 * together -- the point of these fixtures is always "user B's role", and a role
 * whose company belongs to somebody else would be testing the wrong thing.
 */
export async function createRole(userId: string, name: string): Promise<string> {
  const [company] = await admin<{ id: string }[]>`
    insert into job_search.companies (user_id, name, slug)
    values (${userId}, ${name}, ${`${name}-${userId.slice(0, 8)}`.toLowerCase()})
    returning id`;

  const [role] = await admin<{ id: string }[]>`
    insert into job_search.roles (user_id, company_id, title)
    values (${userId}, ${company.id}, ${`${name} engineer`})
    returning id`;

  return role.id;
}

/** Everything in todo hangs off auth.users, directly or through a task. */
export async function truncateAll(): Promise<void> {
  await admin`delete from auth.users`;
}

export async function closeDb(): Promise<void> {
  await sql.end({ timeout: 5 });
}
