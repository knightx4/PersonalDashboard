/**
 * Cross-user isolation for the vault, written before any feature code.
 *
 * The same rule as build step 2, applied to a fourth schema: a table that
 * arrives without a policy has to fail here, immediately, rather than in
 * production months later. The coverage test below is what forces this file to
 * be updated whenever the schema grows.
 *
 * What is at stake here is different in kind from the other three schemas. An
 * order tells you what somebody bought. A note tells you what they think --
 * and a vault is where the private ones live, written for an audience of one
 * who did not expect a web app to be reading over their shoulder. The token
 * next to them can read the whole repository. So the assertions go past "can B
 * select A's rows" to the things that would leak it sideways: the token column,
 * the denormalised owner on notes, and soft-deleted rows, which are still rows.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asUser, closeDb, createUser, truncateAll } from './helpers/db-vault';

let userA = '';
let userB = '';
let connectionA = '';
let connectionB = '';
let noteA = '';

async function seedConnection(userId: string, tag: string): Promise<string> {
  const [row] = await admin<{ id: string }[]>`
    insert into vault_connections (user_id, repo_owner, repo_name, branch, access_token)
    values (${userId}, ${tag}, ${`${tag}-vault`}, 'main', ${`encrypted-${tag}-token`})
    returning id`;
  return row.id;
}

async function seedNote(
  userId: string,
  connectionId: string,
  path: string,
  body: string,
): Promise<string> {
  const [row] = await admin<{ id: string }[]>`
    insert into notes (user_id, connection_id, path, title, body, blob_sha, size_bytes)
    values (${userId}, ${connectionId}, ${path}, ${path.replace(/\.md$/, '')},
            ${body}, ${`sha-${path}`}, ${body.length})
    returning id`;
  return row.id;
}

beforeAll(async () => {
  await truncateAll();
  userA = await createUser('vault-a@example.com');
  userB = await createUser('vault-b@example.com');

  connectionA = await seedConnection(userA, 'alice');
  connectionB = await seedConnection(userB, 'bob');

  noteA = await seedNote(userA, connectionA, 'Journal/2019-04-02.md', 'I am quitting.');
  await seedNote(userB, connectionB, 'Journal/2019-04-02.md', 'Bob wrote this one.');

  await admin`
    insert into sync_runs (connection_id, type, status, to_sha, notes_written)
    values (${connectionA}, 'backfill', 'completed', 'abc123', 1)`;
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

describe('RLS coverage', () => {
  it('has row level security enabled on every table in vault', async () => {
    const rows = await admin<{ tablename: string }[]>`
      select c.relname as tablename
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'vault' and c.relkind = 'r' and not c.relrowsecurity
      order by 1`;
    expect(rows.map((r) => r.tablename)).toEqual([]);
  });

  it('seeds every table, so a new one cannot skip the isolation check', async () => {
    const rows = await admin<{ tablename: string }[]>`
      select c.relname as tablename
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'vault' and c.relkind = 'r'
      order by 1`;
    expect(rows.map((r) => r.tablename)).toEqual(['notes', 'sync_runs', 'vault_connections']);
  });
});

describe('cross-user reads', () => {
  it('shows the owner their vault, its notes and its runs', async () => {
    const seen = await asUser(userA, async (tx) => ({
      connections: (await tx`select id from vault_connections`).length,
      notes: (await tx`select id from notes`).length,
      runs: (await tx`select id from sync_runs`).length,
    }));
    expect(seen).toEqual({ connections: 1, notes: 1, runs: 1 });
  });

  it('shows another user none of it', async () => {
    const seen = await asUser(userB, async (tx) => ({
      connections: (await tx`select id from vault_connections where id = ${connectionA}`).length,
      notes: (await tx`select id from notes where id = ${noteA}`).length,
      runs: (await tx`select id from sync_runs where connection_id = ${connectionA}`).length,
    }));
    expect(seen).toEqual({ connections: 0, notes: 0, runs: 0 });
  });

  it('does not leak the repository token to another user', async () => {
    // Read-only and scoped to one repo, but it still reads a whole repo.
    const rows = await asUser(
      userB,
      (tx) => tx`select access_token from vault_connections where id = ${connectionA}`,
    );
    expect(rows).toHaveLength(0);
  });

  it('does not leak note bodies through a search', async () => {
    // The list page searches; the search must not be a way around the policy.
    const rows = await asUser(
      userB,
      (tx) => tx`select id, body from notes where search_tsv @@ plainto_tsquery('english', 'quitting')`,
    );
    expect(rows).toHaveLength(0);
  });

  it('does not leak a note that only shares a path with your own', async () => {
    // Both users have Journal/2019-04-02.md. The unique index is per user, and
    // a path is not an identifier anyone else can use to reach a row.
    const rows = await asUser(
      userB,
      (tx) => tx`select body from notes where path = 'Journal/2019-04-02.md'`,
    );
    expect(rows).toHaveLength(1);
    expect((rows[0] as { body: string }).body).toBe('Bob wrote this one.');
  });

  it('still hides a soft-deleted note from another user', async () => {
    // Soft delete is a display concern, not a security one. A row that is
    // hidden from its owner is still a row, and still theirs.
    const id = await seedNote(userA, connectionA, 'Deleted/Gone.md', 'Removed upstream.');
    await admin`update notes set deleted_at = now() where id = ${id}`;

    const rows = await asUser(userB, (tx) => tx`select id from notes where id = ${id}`);
    expect(rows).toHaveLength(0);

    const own = await asUser(userA, (tx) => tx`select id from notes where id = ${id}`);
    expect(own).toHaveLength(1);
  });
});

describe('cross-user writes', () => {
  it('does not let another user repoint the vault at their own repository', async () => {
    // The attack this blocks: change someone's remote, wait for the next sync,
    // read their notes out of your own repo's mirror.
    const affected = await asUser(
      userB,
      (tx) => tx`update vault_connections set repo_owner = 'mallory'
                 where id = ${connectionA} returning id`,
    );
    expect(affected).toHaveLength(0);
  });

  it('does not let another user disconnect the vault', async () => {
    const affected = await asUser(
      userB,
      (tx) => tx`update vault_connections set status = 'disconnected'
                 where id = ${connectionA} returning id`,
    );
    expect(affected).toHaveLength(0);
  });

  it('does not let another user edit or delete a note', async () => {
    const edited = await asUser(
      userB,
      (tx) => tx`update notes set body = 'tampered' where id = ${noteA} returning id`,
    );
    expect(edited).toHaveLength(0);

    const deleted = await asUser(
      userB,
      (tx) => tx`delete from notes where id = ${noteA} returning id`,
    );
    expect(deleted).toHaveLength(0);
  });

  it('does not let another user file a note into your vault', async () => {
    // with check, not just using: writing into someone else's vault is how you
    // get a note of your choosing in front of their eyes.
    await expect(
      asUser(
        userB,
        (tx) => tx`insert into notes (user_id, connection_id, path, title, body, blob_sha)
                   values (${userB}, ${connectionA}, 'Planted.md', 'Planted', 'hi', 'sha-x')`,
      ),
    ).rejects.toThrow();
  });
});

describe('integrity the database enforces itself', () => {
  it('refuses a note whose owner disagrees with its connection', async () => {
    // notes.user_id is denormalised from the connection so the list query can
    // use an index. Denormalised ownership that can drift is a hole in RLS, so
    // the database keeps the two equal rather than the sync remembering to.
    await expect(
      admin`insert into notes (user_id, connection_id, path, title, body, blob_sha)
            values (${userB}, ${connectionA}, 'Mismatched.md', 'Mismatched', 'x', 'sha-y')`,
    ).rejects.toThrow(/must match its connection owner/);
  });

  it('refuses a second vault for the same user', async () => {
    await expect(seedConnection(userA, 'alice-again')).rejects.toThrow();
  });

  it('refuses two notes at the same path in one vault', async () => {
    await expect(
      seedNote(userA, connectionA, 'Journal/2019-04-02.md', 'A second copy.'),
    ).rejects.toThrow();
  });

  it('refuses a path that is not markdown', async () => {
    // The .md-only rule is enforced at the transport layer, where it stops the
    // bytes being fetched at all. This is the second line: if a bug ever gets
    // a photo this far, the row does not exist.
    await expect(
      seedNote(userA, connectionA, 'Attachments/photo.png', 'binary'),
    ).rejects.toThrow();
  });

  it('refuses an absolute path', async () => {
    await expect(seedNote(userA, connectionA, '/Journal/Escaped.md', 'x')).rejects.toThrow();
  });

  it('refuses a subpath with a leading or trailing slash', async () => {
    // Normalised on the way in so joining a subpath to a note path never has
    // to guess whether a slash is already there.
    await expect(
      admin`insert into vault_connections (user_id, repo_owner, repo_name, branch, subpath)
            values (${await createUser('vault-c@example.com')}, 'o', 'r', 'main', '/notes')`,
    ).rejects.toThrow();
  });

  it('takes the whole vault with the account', async () => {
    // Account deletion goes through auth.admin.deleteUser, so the vault has
    // to fall out on the foreign keys rather than on the route remembering
    // three more tables. It does -- this is the assertion that says so.
    const userE = await createUser('vault-e@example.com');
    const connection = await seedConnection(userE, 'erin');
    await seedNote(userE, connection, 'Private.md', 'Nobody else should hold this.');
    await admin`insert into sync_runs (connection_id, type) values (${connection}, 'backfill')`;

    await admin`delete from auth.users where id = ${userE}`;

    const [{ connections, notes, runs }] = await admin<
      { connections: number; notes: number; runs: number }[]
    >`select (select count(*) from vault_connections where user_id = ${userE})::int as connections,
             (select count(*) from notes where user_id = ${userE})::int as notes,
             (select count(*) from sync_runs where connection_id = ${connection})::int as runs`;
    expect({ connections, notes, runs }).toEqual({ connections: 0, notes: 0, runs: 0 });
  });

  it('takes the notes and runs with the connection', async () => {
    const userD = await createUser('vault-d@example.com');
    const connection = await seedConnection(userD, 'dave');
    await seedNote(userD, connection, 'Temp.md', 'temporary');
    await admin`insert into sync_runs (connection_id, type) values (${connection}, 'incremental')`;

    await admin`delete from vault_connections where id = ${connection}`;

    const [{ notes, runs }] = await admin<{ notes: number; runs: number }[]>`
      select (select count(*) from notes where connection_id = ${connection})::int as notes,
             (select count(*) from sync_runs where connection_id = ${connection})::int as runs`;
    expect({ notes, runs }).toEqual({ notes: 0, runs: 0 });
  });
});
