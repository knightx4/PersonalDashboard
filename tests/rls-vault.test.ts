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
let themeA = '';
let themeB = '';
let positionA = '';
let positionA2 = '';
let positionB = '';
let sweepA = '';
let proposalA = '';
let mergeA = '';

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

async function seedTheme(userId: string, name: string): Promise<string> {
  const [row] = await admin<{ id: string }[]>`
    insert into themes (user_id, name, about)
    values (${userId}, ${name}, ${`what ${name} covers`})
    returning id`;
  return row.id;
}

async function seedPosition(userId: string, name: string): Promise<string> {
  const [row] = await admin<{ id: string }[]>`
    insert into positions (user_id, name, statement, basis, kind, stance)
    values (${userId}, ${name}, ${`${name}, stated.`}, 'extracted from a note',
            'claim', 'held')
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

  // The map. Every table gets a row, so the coverage guard above stays honest
  // and every assertion below has something real to fail against.
  themeA = await seedTheme(userA, 'Urbanism');
  themeB = await seedTheme(userB, 'Bookkeeping');
  positionA = await seedPosition(userA, 'Parking lots wreck cities');
  positionA2 = await seedPosition(userA, 'Transport cost is land cost');
  positionB = await seedPosition(userB, 'Accruals beat cash for a quarter');

  await admin`
    insert into theme_notes (user_id, theme_id, note_id, basis)
    values (${userA}, ${themeA}, ${noteA}, 'the note is about this')`;
  await admin`
    insert into theme_positions (user_id, theme_id, position_id, basis)
    values (${userA}, ${themeA}, ${positionA}, 'stated under this theme')`;
  await admin`
    insert into position_sources (user_id, position_id, note_id, quote, blob_sha)
    values (${userA}, ${positionA}, ${noteA}, 'I am quitting.', 'sha-Journal/2019-04-02.md')`;
  await admin`
    insert into position_edges (user_id, from_id, to_id, type, description)
    values (${userA}, ${positionA2}, ${positionA}, 'supports', 'land cost is why')`;
  await admin`
    insert into tensions (user_id, left_id, right_id, kind, crux)
    values (${userA}, ${positionA}, ${positionA2}, 'scope', 'metro-wide or local')`;

  // The sweep (plan #757): one run and the row for the note it reached.
  const [sweep] = await admin<{ id: string }[]>`
    insert into map_sweeps (user_id) values (${userA}) returning id`;
  sweepA = sweep.id;
  await admin`
    insert into map_sweep_notes (user_id, sweep_id, note_id, blob_sha, outcome, detail)
    values (${userA}, ${sweepA}, ${noteA}, 'sha-Journal/2019-04-02.md', 'journal',
            'Not read: notes in Me/ are journals.')`;

  // A merge proposal (plan #811). The pair carries no foreign key, so any two
  // of A's ids stand in for two themes without adding a theme the map counts
  // above would see.
  const [first, second] = [positionA, positionA2].sort();
  const [proposal] = await admin<{ id: string }[]>`
    insert into map_merge_proposals (user_id, kind, a_id, b_id, a_name, b_name, source,
                                     similarity, verdict, survivor_id, survivor_name,
                                     reason, confidence, model)
    values (${userA}, 'theme', ${first}, ${second}, 'first', 'second', 'embedding',
            0.8, 'same', ${first}, 'Urbanism', 'One subject.', 0.9, 'claude-haiku-4-5')
    returning id`;
  proposalA = proposal.id;

  // A kept position pair and the search that found it (plan #836).
  await admin`
    insert into position_pairs (user_id, a_id, b_id, similarity, trigram)
    values (${userA}, ${first}, ${second}, 0.8, null)`;
  await admin`
    insert into position_pair_scans (user_id, position_id, name, embedded_at)
    values (${userA}, ${positionA}, 'the name searched with', null)`;

  // A link pair judged to carry an edge, and the search that found it (plan
  // #816).
  await admin`
    insert into position_link_pairs (user_id, a_id, b_id, similarity, judged_at, relation,
                                     from_id, reason, confidence, model)
    values (${userA}, ${first}, ${second}, 0.7, now(), 'supports', ${first},
            'one is why the other holds', 0.8, 'claude-haiku-4-5')`;
  await admin`
    insert into position_link_scans (user_id, position_id, embedded_at)
    values (${userA}, ${positionA}, null)`;

  // A merge log row (plan #813). Written directly: the functions that write it
  // are tests/vault-map-merge.test.ts's subject.
  const [merge] = await admin<{ id: string }[]>`
    insert into map_merges (user_id, kind, survivor_id, absorbed_id, proposal_id,
                            survivor_before, absorbed)
    values (${userA}, 'theme', ${first}, ${second}, ${proposalA}, '{}', '{}')
    returning id`;
  mergeA = merge.id;
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

describe('RLS coverage', () => {
  it('has row level security enabled on every table in the schema', async () => {
    const rows = await admin<{ tablename: string }[]>`
      select c.relname as tablename
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'obsidian' and c.relkind = 'r' and not c.relrowsecurity
      order by 1`;
    expect(rows.map((r) => r.tablename)).toEqual([]);
  });

  it('seeds every table, so a new one cannot skip the isolation check', async () => {
    const rows = await admin<{ tablename: string }[]>`
      select c.relname as tablename
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'obsidian' and c.relkind = 'r'
      order by 1`;
    expect(rows.map((r) => r.tablename)).toEqual([
      'map_merge_proposals',
      'map_merges',
      'map_sweep_notes',
      'map_sweeps',
      'notes',
      'position_edges',
      'position_link_pairs',
      'position_link_scans',
      'position_pair_scans',
      'position_pairs',
      'position_sources',
      'positions',
      'sync_runs',
      'tensions',
      'theme_notes',
      'theme_positions',
      'themes',
      'vault_connections',
    ]);
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
      (tx) =>
        tx`select id, body from notes where search_tsv @@ plainto_tsquery('english', 'quitting')`,
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
    await expect(seedNote(userA, connectionA, 'Attachments/photo.png', 'binary')).rejects.toThrow();
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

describe('the map, across users', () => {
  it('shows the owner their whole map', async () => {
    const seen = await asUser(userA, async (tx) => ({
      themes: (await tx`select id from themes`).length,
      positions: (await tx`select id from positions`).length,
      themeNotes: (await tx`select id from theme_notes`).length,
      themePositions: (await tx`select id from theme_positions`).length,
      sources: (await tx`select id from position_sources`).length,
      edges: (await tx`select id from position_edges`).length,
      tensions: (await tx`select id from tensions`).length,
    }));
    expect(seen).toEqual({
      themes: 1,
      positions: 2,
      themeNotes: 1,
      themePositions: 1,
      sources: 1,
      edges: 1,
      tensions: 1,
    });
  });

  it('shows another user none of it', async () => {
    const seen = await asUser(userB, async (tx) => ({
      themes: (await tx`select id from themes where id = ${themeA}`).length,
      positions: (await tx`select id from positions where id = ${positionA}`).length,
      themeNotes: (await tx`select id from theme_notes where theme_id = ${themeA}`).length,
      themePositions: (await tx`select id from theme_positions where theme_id = ${themeA}`).length,
      sources: (await tx`select id from position_sources where position_id = ${positionA}`).length,
      edges: (await tx`select id from position_edges where from_id = ${positionA2}`).length,
      tensions: (await tx`select id from tensions where left_id = ${positionA}`).length,
    }));
    expect(seen).toEqual({
      themes: 0,
      positions: 0,
      themeNotes: 0,
      themePositions: 0,
      sources: 0,
      edges: 0,
      tensions: 0,
    });
  });

  it('does not leak a note body through the quote stored beside it', async () => {
    // A position's evidence is a verbatim sentence out of a private note. The
    // provenance row is a second copy of that sentence, so it needs the same
    // policy the note does or the map becomes the way around it.
    const rows = await asUser(
      userB,
      (tx) => tx`select quote from position_sources where quote ilike '%quitting%'`,
    );
    expect(rows).toHaveLength(0);
  });

  it('still hides an ungrounded position from another user', async () => {
    // Ungrounded means every quote behind it has left the record. The row
    // stays, because its owner may well still hold the position, and a row
    // that is dimmed for its owner is still theirs.
    await admin`update positions set ungrounded_at = now() where id = ${positionA2}`;

    const theirs = await asUser(
      userB,
      (tx) => tx`select id from positions where id = ${positionA2}`,
    );
    expect(theirs).toHaveLength(0);

    const own = await asUser(userA, (tx) => tx`select id from positions where id = ${positionA2}`);
    expect(own).toHaveLength(1);

    await admin`update positions set ungrounded_at = null where id = ${positionA2}`;
  });

  it('does not let another user edit or delete a position', async () => {
    const edited = await asUser(
      userB,
      (tx) => tx`update positions set statement = 'tampered' where id = ${positionA} returning id`,
    );
    expect(edited).toHaveLength(0);

    const deleted = await asUser(
      userB,
      (tx) => tx`delete from positions where id = ${positionA} returning id`,
    );
    expect(deleted).toHaveLength(0);
  });

  it('does not let another user settle your tension', async () => {
    const affected = await asUser(
      userB,
      (tx) => tx`update tensions set status = 'dismissed', resolved_at = now()
                 where left_id = ${positionA} returning id`,
    );
    expect(affected).toHaveLength(0);
  });

  it('does not let another user file a position into your theme', async () => {
    await expect(
      asUser(
        userB,
        (tx) => tx`insert into theme_positions (user_id, theme_id, position_id, basis)
                   values (${userB}, ${themeA}, ${positionB}, 'planted')`,
      ),
    ).rejects.toThrow();
  });

  it('refuses a join across two accounts even with RLS out of the way', async () => {
    // The one that matters. Foreign keys are not subject to RLS, so a policy
    // alone would not stop a row joining one account's position to another's
    // theme. Every key here carries user_id for exactly this, and the check
    // runs as admin because that is the case a policy cannot see.
    await expect(
      admin`insert into theme_positions (user_id, theme_id, position_id, basis)
            values (${userB}, ${themeA}, ${positionB}, 'cross-account')`,
    ).rejects.toThrow();

    await expect(
      admin`insert into position_edges (user_id, from_id, to_id, type)
            values (${userB}, ${positionA}, ${positionB}, 'supports')`,
    ).rejects.toThrow();

    await expect(
      admin`insert into position_sources (user_id, position_id, note_id, quote, blob_sha)
            values (${userB}, ${positionB}, ${noteA}, 'I am quitting.', 'sha-x')`,
    ).rejects.toThrow();

    await expect(
      admin`insert into theme_notes (user_id, theme_id, note_id, basis)
            values (${userB}, ${themeB}, ${noteA}, 'cross-account')`,
    ).rejects.toThrow();
  });

  it('does not let a membership be edited into a different one', async () => {
    // A row in a join table is the pair it names. Changing either end is a
    // different claim, which is a delete and an insert, so these tables carry
    // no update policy -- and no update grant either, which is the stronger
    // half: the privilege is refused before a policy is ever consulted, so
    // this cannot be loosened by adding a policy without also noticing.
    await expect(
      asUser(
        userA,
        (tx) => tx`update theme_positions set basis = 'rewritten'
                   where theme_id = ${themeA} returning id`,
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('what the map enforces itself', () => {
  it('orders a tension pair, so one dismissed cannot return from the other side', async () => {
    const a = await seedPosition(userA, 'Upzoning lowers rents metro-wide');
    const b = await seedPosition(userA, 'New buildings track rising rents');
    const [lo, hi] = a < b ? [a, b] : [b, a];

    // Written the "wrong" way round on purpose.
    const [row] = await admin<{ left_id: string; right_id: string }[]>`
      insert into tensions (user_id, left_id, right_id, kind, crux)
      values (${userA}, ${hi}, ${lo}, 'scope', 'metro-wide over years, or local')
      returning left_id, right_id`;
    expect([row.left_id, row.right_id]).toEqual([lo, hi]);

    await expect(
      admin`insert into tensions (user_id, left_id, right_id, kind, crux)
            values (${userA}, ${lo}, ${hi}, 'level', 'found again from the other side')`,
    ).rejects.toThrow();
  });

  it('refuses a tension that is settled without a date, or open with one', async () => {
    await expect(
      admin`insert into tensions (user_id, left_id, right_id, kind, status, crux)
            values (${userA}, ${positionA}, ${positionA2}, 'scope', 'resolved', 'no date')`,
    ).rejects.toThrow();
  });

  it('refuses a position with no statement, and a source with no quote', async () => {
    await expect(
      admin`insert into positions (user_id, name, statement, basis, kind, stance)
            values (${userA}, 'Nameless', '', 'from a note', 'claim', 'held')`,
    ).rejects.toThrow();

    await expect(
      admin`insert into position_sources (user_id, position_id, note_id, quote, blob_sha)
            values (${userA}, ${positionA}, ${noteA}, '', 'sha-x')`,
    ).rejects.toThrow();
  });

  it('refuses two themes with the same name in one vault, whatever the case', async () => {
    await expect(seedTheme(userA, 'urbanism')).rejects.toThrow();
  });

  it('lets two people hold the same theme name', async () => {
    const id = await seedTheme(userB, 'Urbanism');
    expect(id).toBeTruthy();
  });

  it('refuses an edge from a position to itself', async () => {
    await expect(
      admin`insert into position_edges (user_id, from_id, to_id, type)
            values (${userA}, ${positionA}, ${positionA}, 'supports')`,
    ).rejects.toThrow();
  });
});

describe('the sweep, across users', () => {
  it('shows the owner their sweep and what it did to each note', async () => {
    const seen = await asUser(userA, async (tx) => ({
      sweeps: (await tx`select id from map_sweeps`).length,
      notes: (await tx`select id from map_sweep_notes`).length,
      counts: (
        await tx<{ c: { outcomes: Record<string, number> } }[]>`
        select map_sweep_counts(${sweepA}) as c`
      )[0].c.outcomes,
    }));
    expect(seen).toEqual({ sweeps: 1, notes: 1, counts: { journal: 1 } });
  });

  it('shows another user none of it, counts included', async () => {
    const seen = await asUser(userB, async (tx) => ({
      sweeps: (await tx`select id from map_sweeps where id = ${sweepA}`).length,
      notes: (await tx`select id from map_sweep_notes where sweep_id = ${sweepA}`).length,
      counts: (
        await tx<{ c: { outcomes: Record<string, number> } }[]>`
        select map_sweep_counts(${sweepA}) as c`
      )[0].c.outcomes,
    }));
    expect(seen).toEqual({ sweeps: 0, notes: 0, counts: {} });
  });

  it('does not let another user stop, resume or start your sweep', async () => {
    const stopped = await asUser(
      userB,
      (tx) => tx`update map_sweeps set status = 'stopped' where id = ${sweepA} returning id`,
    );
    expect(stopped).toHaveLength(0);

    await expect(
      asUser(userB, (tx) => tx`insert into map_sweeps (user_id) values (${userA})`),
    ).rejects.toThrow();
  });

  it('lets the owner stop their sweep but not write its note rows', async () => {
    const stopped = await asUser(
      userA,
      (tx) => tx`update map_sweeps set status = 'stopped' where id = ${sweepA} returning id`,
    );
    expect(stopped).toHaveLength(1);
    await admin`update map_sweeps set status = 'running' where id = ${sweepA}`;

    // The per-note rows are the cron call's record. A signed-in person reads them.
    await expect(
      asUser(
        userA,
        (tx) => tx`update map_sweep_notes set outcome = 'read' where sweep_id = ${sweepA}`,
      ),
    ).rejects.toThrow();
  });

  it('refuses a second unfinished sweep for one person', async () => {
    await expect(admin`insert into map_sweeps (user_id) values (${userA})`).rejects.toThrow();
  });

  it('refuses a sweep row for a note in another vault', async () => {
    const [noteB] = await admin<{ id: string }[]>`select id from notes where user_id = ${userB}`;
    await expect(
      admin`insert into map_sweep_notes (user_id, sweep_id, note_id, blob_sha, outcome)
            values (${userA}, ${sweepA}, ${noteB.id}, 'sha', 'read')`,
    ).rejects.toThrow();
  });
});

describe('merge proposals, across users', () => {
  it('shows the owner their proposals and another user none', async () => {
    const own = await asUser(userA, (tx) => tx`select id from map_merge_proposals`);
    const other = await asUser(
      userB,
      (tx) => tx`select id from map_merge_proposals where id = ${proposalA}`,
    );
    expect([own.length, other.length]).toEqual([1, 0]);
  });

  it('does not let another user rewrite, delete or file a proposal as you', async () => {
    const updated = await asUser(
      userB,
      (tx) => tx`update map_merge_proposals set verdict = 'different', survivor_id = null,
                   survivor_name = null where id = ${proposalA} returning id`,
    );
    const deleted = await asUser(
      userB,
      (tx) => tx`delete from map_merge_proposals where id = ${proposalA} returning id`,
    );
    expect([updated.length, deleted.length]).toEqual([0, 0]);

    await expect(
      asUser(
        userB,
        (tx) => tx`insert into map_merge_proposals (user_id, kind, a_id, b_id, a_name, b_name,
                     source, verdict, reason, confidence, model)
                   values (${userA}, 'theme', ${themeB}, ${themeA}, 'x', 'y', 'trigram',
                           'different', 'r', 0.5, 'm')`,
      ),
    ).rejects.toThrow();
  });

  it('refuses a same verdict with no survivor, and a pair judged twice', async () => {
    const [row] = await admin<{ a_id: string; b_id: string }[]>`
      select a_id, b_id from map_merge_proposals where id = ${proposalA}`;
    await expect(
      admin`insert into map_merge_proposals (user_id, kind, a_id, b_id, a_name, b_name, source,
                                             verdict, reason, confidence, model)
            values (${userA}, 'position', ${row.a_id}, ${row.b_id}, 'x', 'y', 'trigram',
                    'same', 'r', 0.5, 'm')`,
    ).rejects.toThrow();
    await expect(
      admin`insert into map_merge_proposals (user_id, kind, a_id, b_id, a_name, b_name, source,
                                             verdict, reason, confidence, model)
            values (${userA}, 'theme', ${row.a_id}, ${row.b_id}, 'x', 'y', 'trigram',
                    'different', 'r', 0.5, 'm')`,
    ).rejects.toThrow();
  });
});

describe('kept position pairs, across users', () => {
  it('shows the owner their pairs and searches and another user none', async () => {
    const own = await asUser(userA, async (tx) => ({
      pairs: (await tx`select a_id from position_pairs`).length,
      scans: (await tx`select position_id from position_pair_scans`).length,
    }));
    const other = await asUser(userB, async (tx) => ({
      pairs: (await tx`select a_id from position_pairs`).length,
      scans: (await tx`select position_id from position_pair_scans`).length,
    }));
    expect([own, other]).toEqual([
      { pairs: 1, scans: 1 },
      { pairs: 0, scans: 0 },
    ]);
  });

  it('does not let another user delete a pair or file one as you', async () => {
    const deleted = await asUser(
      userB,
      (tx) => tx`delete from position_pairs where user_id = ${userA} returning a_id`,
    );
    expect(deleted.length).toBe(0);

    await expect(
      asUser(
        userB,
        (tx) => tx`insert into position_pair_scans (user_id, position_id, name)
                   values (${userA}, ${positionA2}, 'x')`,
      ),
    ).rejects.toThrow();
  });
});

describe('link pairs, across users', () => {
  it('shows the owner their link pairs and searches and another user none', async () => {
    const own = await asUser(userA, async (tx) => ({
      pairs: (await tx`select a_id from position_link_pairs`).length,
      scans: (await tx`select position_id from position_link_scans`).length,
    }));
    const other = await asUser(userB, async (tx) => ({
      pairs: (await tx`select a_id from position_link_pairs`).length,
      scans: (await tx`select position_id from position_link_scans`).length,
    }));
    expect([own, other]).toEqual([
      { pairs: 1, scans: 1 },
      { pairs: 0, scans: 0 },
    ]);
  });

  it('does not let another user judge a pair or record links against it', async () => {
    const judged = await asUser(
      userB,
      (tx) => tx`update position_link_pairs set relation = 'none', from_id = null
                 where user_id = ${userA} returning a_id`,
    );
    expect(judged.length).toBe(0);

    const [first, second] = [positionA, positionA2].sort();
    const [row] = await asUser(
      userB,
      (tx) => tx`select * from record_position_links(${JSON.stringify([
        { a_id: first, b_id: second, relation: 'contradicts', from_id: first,
          reason: 'x', confidence: 0.5, model: 'm' },
      ])}::jsonb)`,
    );
    expect([row.recorded, row.edges]).toEqual([0, 0]);
  });
});

describe('the merge log, across users', () => {
  it('shows the owner their merges and another user none', async () => {
    const own = await asUser(userA, (tx) => tx`select id from map_merges`);
    const other = await asUser(userB, (tx) => tx`select id from map_merges where id = ${mergeA}`);
    expect([own.length, other.length]).toEqual([1, 0]);
  });

  it('lets nobody signed in write the log, the owner included', async () => {
    // Only merge_themes, merge_positions and undo_map_merge write it; a row
    // edited by hand would make undo put back something that never was.
    await expect(
      asUser(userA, (tx) => tx`update map_merges set undone_at = now() where id = ${mergeA}`),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(userA, (tx) => tx`delete from map_merges where id = ${mergeA}`),
    ).rejects.toThrow(/permission denied/);
  });
});
