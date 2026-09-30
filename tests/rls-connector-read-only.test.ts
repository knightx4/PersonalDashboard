/**
 * A connected app's token can read and cannot write (plan #1257).
 *
 * Supabase's OAuth server issues ordinary user JWTs with a client_id claim,
 * and anyone holding one can call the database API directly. Migration 0134
 * makes public.connector_read_only() PostgREST's pre-request function: for
 * claims carrying client_id it turns the request's transaction read-only.
 * These tests do what PostgREST does per request -- set the role, set the
 * claims, call the pre-request -- and then try to write to a table in every
 * schema the API exposes, the way a client holding the token would.
 *
 * The statements write nothing even where they are allowed (`where false`):
 * the read-only check refuses a write before any row is looked at, so an
 * empty write is enough to tell a refused request from an allowed one.
 */
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, closeDb, createUser, truncateAll } from './helpers/db';

/** One table in each schema the database API exposes. */
const TABLES = [
  'core.connector_calls',
  'goals.answers',
  'job_search.application_answers',
  'learn.aims',
  'news.addresses',
  'obsidian.jev_trial_answers',
  'public.orders',
  'todo.agenda_settings',
];

const READ_ONLY = /read-only transaction/;

let userId = '';

beforeAll(async () => {
  await truncateAll();
  userId = await createUser('connector-read-only@example.com');
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

/** One request as PostgREST makes it: role, claims, then the pre-request function. */
async function asRequest<T>(
  claims: Record<string, unknown>,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return admin.begin(async (tx) => {
    await tx.unsafe(`set local role authenticated`);
    await tx`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`;
    await tx`select public.connector_read_only()`;
    return fn(tx);
  }) as Promise<T>;
}

function connectorClaims() {
  return { sub: userId, role: 'authenticated', aud: 'authenticated', client_id: 'claude-client' };
}

function sessionClaims() {
  return { sub: userId, role: 'authenticated', aud: 'authenticated' };
}

/** The error a statement raised as the request, or null when it ran. */
async function attempt(claims: Record<string, unknown>, statement: string): Promise<string | null> {
  try {
    await asRequest(claims, (tx) => tx.unsafe(statement));
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

describe('a token carrying client_id', () => {
  it.each(TABLES)('is refused insert, update and delete on %s', async (table) => {
    expect(await attempt(connectorClaims(), `insert into ${table} select * from ${table} where false`)).toMatch(READ_ONLY);
    expect(await attempt(connectorClaims(), `update ${table} set user_id = user_id where false`)).toMatch(READ_ONLY);
    expect(await attempt(connectorClaims(), `delete from ${table} where false`)).toMatch(READ_ONLY);
  });

  it.each(TABLES)('still reads %s', async (table) => {
    expect(await attempt(connectorClaims(), `select count(*) from ${table}`)).toBeNull();
  });

  it('cannot write its own call log, which the route writes with the service role instead', async () => {
    const error = await attempt(
      connectorClaims(),
      `insert into core.connector_calls (user_id, client_id, tool, outcome) values ('${userId}', 'claude-client', 'todos', 'ok')`,
    );
    expect(error).toMatch(READ_ONLY);
  });

  it('cannot switch the transaction back to read-write', async () => {
    expect(await attempt(connectorClaims(), `set transaction read write`)).toMatch(/must be set before any query/);
  });
});

describe('an ordinary sign-in session', () => {
  it('is left read-write', async () => {
    const mode = await asRequest(sessionClaims(), (tx) => tx`show transaction_read_only`);
    expect(mode[0].transaction_read_only).toBe('off');
  });

  it('still writes what its policies allow', async () => {
    const rows = await asRequest(
      sessionClaims(),
      (tx) => tx`
        insert into core.connector_calls (user_id, client_id, tool, outcome)
        values (${userId}, 'claude-client', 'todos', 'ok')
        returning id`,
    );
    expect(rows).toHaveLength(1);
  });

  it('with no token at all is left read-write too', async () => {
    const mode = await admin.begin(async (tx) => {
      await tx.unsafe(`set local role anon`);
      await tx`select set_config('request.jwt.claims', '{"role":"anon"}', true)`;
      await tx`select public.connector_read_only()`;
      return tx`show transaction_read_only`;
    });
    expect(mode[0].transaction_read_only).toBe('off');
  });
});
