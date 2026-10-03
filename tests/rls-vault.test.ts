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

/** A vector literal of the width note_embeddings takes. */
const VECTOR = `[${new Array(1024).fill(0.01).join(',')}]`;

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
let threadA = '';
let transcriptA = '';
let transcriptB = '';

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

  // A map trial answer on that note (plan #1168); only the trial job writes these.
  await admin`
    insert into jev_trial_answers (user_id, trial, note_id, blob_sha, not_sent)
    values (${userA}, 'test', ${noteA}, 'sha-Journal/2019-04-02.md', 'journal')`;

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

  // What a reset did with that merge (plan #879). Written directly for the
  // same reason.
  await admin`
    insert into map_merge_resets (user_id, reset, kind, merge_id, outcome, detail)
    values (${userA}, 'plan #879', 'theme', ${mergeA}, 'failed', 'name-taken: taken')`;

  // Maya (plan #1283): a thread on A's note, its thought, and the gate check
  // that looked at the note first. The old tables are read-only since plan
  // #1479 moved the threads to core.conversations, so the thread from before
  // the move is written past the trigger, and the same thread as it now is
  // goes in core.conversations under the note's ref.
  const [thread] = await admin.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    const rows = await tx<{ id: string }[]>`
      insert into maya_threads (user_id, note_id, question, origin)
      values (${userA}, ${noteA}, 'Should I quit?', 'asked')
      returning id`;
    await tx`
      insert into maya_messages (thread_id, user_id, role, kind, body, points, note_blob_sha, model)
      values (${rows[0].id}, ${userA}, 'maya', 'thought', 'Three things bear on this.', '[]'::jsonb,
              'sha-Journal/2019-04-02.md', 'claude-opus')`;
    return rows;
  });
  threadA = thread.id;
  await admin`
    insert into core.conversations (id, user_id, subject_kind, subject_ref, title, voice, origin)
    values (${threadA}, ${userA}, 'row', ${`obsidian.notes:${noteA}`}, 'Should I quit?', 'maya', 'asked')`;
  await admin`
    insert into core.conversation_turns (conversation_id, user_id, role, body, detail)
    values (${threadA}, ${userA}, 'assistant', 'Three things bear on this.',
            '{"kind": "thought", "points": []}'::jsonb)`;
  await admin`
    insert into maya_gate_checks (user_id, note_id, blob_sha, probability, outcome, jev_model)
    values (${userA}, ${noteA}, 'sha-Journal/2019-04-02.md', 0.9, 'thought', 'jev')`;

  // An attachment (plan #1299) for each user, at the same path, so the
  // isolation check below has a row of B's to miss.
  for (const [user, connection] of [[userA, connectionA], [userB, connectionB]]) {
    await admin`
      insert into attachments (user_id, connection_id, path, blob_sha, size_bytes, mime_type, storage_path)
      values (${user}, ${connection}, 'Attachments/scan.pdf', 'sha-scan', 2048, 'application/pdf',
              ${`${user}/${connection}/sha-scan`})`;
  }

  // A transcript and a course on it (plan #1306) for each user, at the same
  // school, so the isolation checks below have rows of B's to miss.
  for (const user of [userA, userB]) {
    const [transcript] = await admin<{ id: string }[]>`
      insert into transcripts (user_id, school, file_name, storage_path, mime_type, size_bytes)
      values (${user}, 'State University', 'record.pdf', ${`${user}/t-record.pdf`},
              'application/pdf', 4096)
      returning id`;
    await admin`
      insert into courses (user_id, transcript_id, school, code, title, term, year, credits, grade, position)
      values (${user}, ${transcript.id}, 'State University', 'HIST 101', 'World History',
              'Fall', 2019, 3, 'A-', 0)`;
    if (user === userA) transcriptA = transcript.id;
    else transcriptB = transcript.id;
  }

  // A note's vector (plan #1111), written through the function the sync uses
  // so the hash is the one it would store.
  await admin`
    select store_note_embeddings(jsonb_build_array(jsonb_build_object(
      'note_id', note_id, 'body_hash', body_hash, 'embedding', ${VECTOR}::text, 'model', 'voyage-4-lite')))
    from stale_note_embeddings(1, ${userA})`;
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
      'attachments',
      'courses',
      'jev_trial_answers',
      'map_merge_proposals',
      'map_merge_resets',
      'map_merges',
      'map_sweep_notes',
      'map_sweeps',
      'maya_gate_checks',
      'maya_messages',
      'maya_threads',
      'note_connections',
      'note_embeddings',
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
      'text_embeddings',
      'theme_notes',
      'theme_positions',
      'themes',
      'transcripts',
      'vault_connections',
    ]);
  });
});

describe('cross-user reads', () => {
  it('shows a map trial answer to its owner only', async () => {
    const count = (user: string) =>
      asUser(user, async (tx) => (await tx`select id from jev_trial_answers`).length);
    expect(await count(userA)).toBe(1);
    expect(await count(userB)).toBe(0);
  });

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
      (tx) => tx`select * from record_position_links(${tx.json([
        { a_id: first, b_id: second, relation: 'contradicts', from_id: first,
          reason: 'x', confidence: 0.5, model: 'm' },
      ] as never)})`,
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

  it('shows the owner what a reset did and another user nothing, and lets neither write it', async () => {
    const own = await asUser(userA, (tx) => tx`select id from map_merge_resets`);
    const other = await asUser(userB, (tx) => tx`select id from map_merge_resets`);
    expect([own.length, other.length]).toEqual([1, 0]);
    await expect(
      asUser(userA, (tx) => tx`delete from map_merge_resets where merge_id = ${mergeA}`),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('note embeddings, across users', () => {
  it('shows the owner their note vectors and another user none', async () => {
    const own = await asUser(userA, (tx) => tx`select note_id from note_embeddings`);
    const other = await asUser(userB, (tx) => tx`select note_id from note_embeddings`);
    expect([own.length, other.length]).toEqual([1, 0]);
  });

  it('lists only the caller\'s own stale notes and will not store a vector on another user\'s note', async () => {
    const [hash] = await admin<{ h: string }[]>`
      select md5(note_embedding_text(title, body)) as h from notes where id = ${noteA}`;
    const stale = await asUser(userB, (tx) => tx`select note_id from stale_note_embeddings(100, null)`);
    expect(stale.map((row) => row.note_id)).not.toContain(noteA);

    const [row] = await asUser(
      userB,
      (tx) => tx`select store_note_embeddings(${tx.json([
        { note_id: noteA, body_hash: hash.h, embedding: VECTOR, model: 'm' },
      ] as never)}) as written`,
    );
    expect(row.written).toBe(0);
    const [kept] = await admin<{ model: string }[]>`
      select embedding_model as model from note_embeddings where note_id = ${noteA}`;
    expect(kept.model).toBe('voyage-4-lite');
  });

  it('takes a note off the stale list once stored, and puts it back when the note changes', async () => {
    const before = await asUser(userA, (tx) => tx`select note_id from stale_note_embeddings(100, null)`);
    expect(before.map((row) => row.note_id)).not.toContain(noteA);

    await admin`update notes set body = body || ' and one more line' where id = ${noteA}`;
    const after = await asUser(userA, (tx) => tx`select note_id from stale_note_embeddings(100, null)`);
    expect(after.map((row) => row.note_id)).toContain(noteA);
  });
});

describe('nearest notes and the text cache (plan #1112)', () => {
  // Long enough to clear the stub floor (vault 0023). The vector is unchanged:
  // it was stored for the note, not computed from the body.
  const LONG_BODY = 'I am quitting. I told them this morning and it felt right.';
  beforeAll(async () => {
    await admin`update notes set body = ${LONG_BODY} where id = ${noteA}`;
  });
  afterAll(async () => {
    await admin`update notes set body = 'I am quitting.' where id = ${noteA}`;
  });

  const nearest = (tx: import('postgres').TransactionSql, exclude: string[] | null = null) =>
    tx`select note_id, similarity from nearest_notes(${VECTOR}, null, 5, 0.5, 'voyage-4-lite', ${exclude}::uuid[])`;

  it('finds the owner\'s note and nothing for another user', async () => {
    const own = await asUser(userA, (tx) => nearest(tx));
    const other = await asUser(userB, (tx) => nearest(tx));
    expect(own.map((row) => row.note_id)).toEqual([noteA]);
    expect(Number(own[0].similarity)).toBeCloseTo(1, 5);
    expect(other).toEqual([]);
  });

  it('leaves out a soft-deleted note and a note the caller excludes', async () => {
    expect(await asUser(userA, (tx) => nearest(tx, [noteA]))).toEqual([]);
    await admin`update notes set deleted_at = now() where id = ${noteA}`;
    try {
      expect(await asUser(userA, (tx) => nearest(tx))).toEqual([]);
    } finally {
      await admin`update notes set deleted_at = null where id = ${noteA}`;
    }
  });

  // Plan #1114 (vault 0023, 0024): a note with next to nothing written in it,
  // a template or an instruction file is never offered as a related note.
  // noteA's fixture body ("I am quitting.") is itself under the 20-character
  // floor, so the cases above lengthen it for the duration.
  it('leaves out a stub, a template and an instruction file', async () => {
    const withBody = async (body: string, path: string) => {
      await admin`update notes set body = ${body}, path = ${path} where id = ${noteA}`;
      return (await asUser(userA, (tx) => nearest(tx))).map((row) => row.note_id);
    };
    try {
      expect(await withBody('[[AI]] #idea', 'Journal/2019-04-02.md')).toEqual([]);
      expect(await withBody(LONG_BODY, 'Resources/Templates/Idea.md')).toEqual([]);
      expect(await withBody(LONG_BODY, 'CLAUDE.md')).toEqual([]);
      expect(await withBody(LONG_BODY, 'Journal/2019-04-02.md')).toEqual([noteA]);
    } finally {
      await admin`
        update notes set body = ${LONG_BODY}, path = 'Journal/2019-04-02.md' where id = ${noteA}`;
    }
  });

  it('keeps a text vector for its owner only', async () => {
    await asUser(userA, (tx) => tx`
      insert into text_embeddings (user_id, text_hash, embedding_model, embedding)
      values (${userA}, 'h1', 'voyage-4-lite', ${VECTOR})`);
    const own = await asUser(userA, (tx) => tx`select text_hash from text_embeddings`);
    const other = await asUser(userB, (tx) => tx`select text_hash from text_embeddings`);
    expect([own.length, other.length]).toEqual([1, 0]);
    await expect(
      asUser(userB, (tx) => tx`
        insert into text_embeddings (user_id, text_hash, embedding_model, embedding)
        values (${userA}, 'h2', 'voyage-4-lite', ${VECTOR})`),
    ).rejects.toThrow();
  });
});

describe('weekly connections (plan #1115)', () => {
  // noteA is this week's note: it was inserted by the test run. olderA is
  // given a date a month back and the same vector, so the two are a pair.
  const LONG_BODY = 'I am quitting. I told them this morning and it felt right.';
  const OLDER_BODY = 'On leaving a job: what I would want in place before I go, and who to tell first.';
  let olderA = '';
  let connectionRow = '';

  beforeAll(async () => {
    await admin`update notes set body = ${LONG_BODY} where id = ${noteA}`;
    const [older] = await admin<{ id: string }[]>`
      insert into notes (user_id, connection_id, path, title, body, blob_sha, size_bytes, written_at)
      values (${userA}, ${connectionA}, 'Ideas/Leaving.md', 'Leaving', ${OLDER_BODY},
              'sha-leaving', ${OLDER_BODY.length}, now() - interval '30 days')
      returning id`;
    olderA = older.id;
    await admin`
      select store_note_embeddings(jsonb_build_array(jsonb_build_object(
        'note_id', note_id, 'body_hash', body_hash, 'embedding', ${VECTOR}::text, 'model', 'voyage-4-lite')))
      from stale_note_embeddings(5, ${userA}) where note_id = ${olderA}`;
    const [row] = await admin<{ id: string }[]>`
      insert into note_connections (user_id, week_ending, older_note_id, recent_note_ids, sentence, similarity)
      values (${userA}, current_date, ${olderA}, array[${noteA}]::uuid[], 'Both are about leaving a job.', 0.7)
      returning id`;
    connectionRow = row.id;
  });

  afterAll(async () => {
    await admin`delete from note_connections where user_id = ${userA}`;
    await admin`delete from notes where id = ${olderA}`;
    await admin`update notes set body = 'I am quitting.' where id = ${noteA}`;
  });

  const neighbours = (tx: import('postgres').TransactionSql) =>
    tx`select recent_id, older_id, similarity, mutual_rank
         from recent_note_neighbours(${userA}, now() - interval '7 days', 5, 0.5)`;

  it('pairs the week\'s note with the older one, for their owner only', async () => {
    const own = await asUser(userA, (tx) => neighbours(tx));
    expect(own.map((row) => [row.recent_id, row.older_id, row.mutual_rank])).toEqual([[noteA, olderA, 1]]);
    expect(Number(own[0].similarity)).toBeCloseTo(1, 5);
    expect(await asUser(userB, (tx) => neighbours(tx))).toEqual([]);
  });

  it('shows a connection to its owner only, who may hide it and change nothing else', async () => {
    expect((await asUser(userA, (tx) => tx`select id from note_connections`)).length).toBe(1);
    expect(await asUser(userB, (tx) => tx`select id from note_connections`)).toEqual([]);

    const hiddenByB = await asUser(userB, (tx) => tx`
      update note_connections set dismissed_at = now() where id = ${connectionRow} returning id`);
    expect(hiddenByB).toEqual([]);

    await expect(
      asUser(userA, (tx) => tx`update note_connections set sentence = 'rewritten' where id = ${connectionRow}`),
    ).rejects.toThrow();
    await expect(
      asUser(userA, (tx) => tx`
        insert into note_connections (user_id, week_ending, older_note_id, recent_note_ids, similarity)
        values (${userA}, current_date - 7, ${olderA}, array[${noteA}]::uuid[], 0.7)`),
    ).rejects.toThrow();

    const hidden = await asUser(userA, (tx) => tx`
      update note_connections set dismissed_at = now() where id = ${connectionRow} returning id`);
    expect(hidden.length).toBe(1);
  });

  it('moves a note\'s written_at only when it grows by about a paragraph', async () => {
    const writtenAt = async () =>
      (await admin<{ written_at: Date }[]>`select written_at from notes where id = ${olderA}`)[0].written_at.getTime();
    const before = await writtenAt();

    await admin`update notes set body = body || ' A few more words.', path = 'Ideas/Leaving a job.md' where id = ${olderA}`;
    expect(await writtenAt()).toBe(before);

    await admin`update notes set body = body || ${' ' + 'Another sentence about the plan. '.repeat(10)} where id = ${olderA}`;
    expect(await writtenAt()).toBeGreaterThan(before);
  });
});

describe('Maya, across users (plan #1283)', () => {
  it('shows threads, messages and gate checks to their owner only', async () => {
    const seen = (user: string) =>
      asUser(user, async (tx) => ({
        threads: (await tx`select id from maya_threads`).length,
        messages: (await tx`select id from maya_messages`).length,
        checks: (await tx`select id from maya_gate_checks`).length,
      }));
    expect(await seen(userA)).toEqual({ threads: 1, messages: 1, checks: 1 });
    expect(await seen(userB)).toEqual({ threads: 0, messages: 0, checks: 0 });
  });

  it('takes no more writes in the old tables (plan #1479)', async () => {
    await expect(
      admin`update maya_threads set question = 'Is it time to leave?' where id = ${threadA}`,
    ).rejects.toThrow(/read-only/);
    await expect(
      admin`insert into maya_messages (thread_id, user_id, role, kind, body)
            values (${threadA}, ${userA}, 'person', 'reply', 'I think so.')`,
    ).rejects.toThrow(/read-only/);
  });

  it('keeps the thread in core.conversations: the owner rewrites the question and adds to it, nobody else', async () => {
    const byB = await asUser(userB, (tx) => tx`
      update core.conversations set title = 'hijacked' where id = ${threadA} returning id`);
    expect(byB).toEqual([]);
    const byA = await asUser(userA, (tx) => tx`
      update core.conversations set title = 'Is it time to leave?' where id = ${threadA} returning id`);
    expect(byA.length).toBe(1);

    const own = await asUser(userA, (tx) => tx`
      insert into core.conversation_turns (conversation_id, user_id, role, body)
      values (${threadA}, ${userA}, 'user', 'I think so.') returning id`);
    expect(own.length).toBe(1);
    await expect(
      asUser(userB, (tx) => tx`
        insert into core.conversation_turns (conversation_id, user_id, role, body)
        values (${threadA}, ${userB}, 'user', 'planted')`),
    ).rejects.toThrow();
    await admin`delete from core.conversation_turns where conversation_id = ${threadA} and role = 'user'`;
  });

  it('refuses a thread on someone else\'s note, a second thread on a note, and a thought of the person\'s', async () => {
    await expect(
      asUser(userB, (tx) => tx`
        insert into core.conversations (user_id, subject_kind, subject_ref, voice, origin)
        values (${userB}, 'row', ${`obsidian.notes:${noteA}`}, 'maya', 'asked')`),
    ).rejects.toThrow();
    await expect(
      admin`insert into core.conversations (user_id, subject_kind, subject_ref, voice, origin)
            values (${userA}, 'row', ${`obsidian.notes:${noteA}`}, 'maya', 'automatic')`,
    ).rejects.toThrow();
    await expect(
      admin`insert into core.conversation_turns (conversation_id, user_id, role, body, detail)
            values (${threadA}, ${userA}, 'user', 'not mine to write', '{"kind": "thought"}'::jsonb)`,
    ).rejects.toThrow();
  });

  it('keeps gate checks to the job: the owner writes none', async () => {
    await expect(
      asUser(userA, (tx) => tx`
        insert into maya_gate_checks (user_id, note_id, blob_sha, outcome)
        values (${userA}, ${noteA}, 'sha-other', 'skip')`),
    ).rejects.toThrow();
    await expect(
      admin`insert into maya_gate_checks (user_id, note_id, blob_sha, outcome)
            values (${userA}, ${noteA}, 'sha-Journal/2019-04-02.md', 'skip')`,
    ).rejects.toThrow();
  });
});

describe('attachments, across users (plan #1299)', () => {
  it('shows each account its own attachments only', async () => {
    const seen = (user: string) =>
      asUser(user, (tx) => tx<{ user_id: string }[]>`select user_id from attachments`);
    expect((await seen(userA)).map((r) => r.user_id)).toEqual([userA]);
    expect((await seen(userB)).map((r) => r.user_id)).toEqual([userB]);
  });

  it('keeps the table to the sync: the owner writes nothing', async () => {
    await expect(
      asUser(userA, (tx) => tx`
        insert into attachments (user_id, connection_id, path, blob_sha, size_bytes, mime_type)
        values (${userA}, ${connectionA}, 'Attachments/planted.png', 'sha-p', 10, 'image/png')`),
    ).rejects.toThrow();
    await expect(
      asUser(userA, (tx) => tx`update attachments set storage_path = null`),
    ).rejects.toThrow();
    await expect(asUser(userA, (tx) => tx`delete from attachments`)).rejects.toThrow();
  });

  it('refuses a row on someone else\'s connection, a stored copy over 50 MB, a copy outside the owner\'s folder and an unkept type', async () => {
    await expect(
      admin`insert into attachments (user_id, connection_id, path, blob_sha, size_bytes, mime_type)
            values (${userB}, ${connectionA}, 'Attachments/other.png', 'sha-o', 10, 'image/png')`,
    ).rejects.toThrow();
    await expect(
      admin`insert into attachments (user_id, connection_id, path, blob_sha, size_bytes, mime_type, storage_path)
            values (${userA}, ${connectionA}, 'Attachments/huge.mp3', 'sha-h', 52428801, 'audio/mpeg',
                    ${`${userA}/${connectionA}/sha-h`})`,
    ).rejects.toThrow();
    await expect(
      admin`insert into attachments (user_id, connection_id, path, blob_sha, size_bytes, mime_type, storage_path)
            values (${userA}, ${connectionA}, 'Attachments/moved.png', 'sha-m', 10, 'image/png',
                    ${`${userB}/${connectionA}/sha-m`})`,
    ).rejects.toThrow();
    await expect(
      admin`insert into attachments (user_id, connection_id, path, blob_sha, size_bytes, mime_type)
            values (${userA}, ${connectionA}, 'Attachments/diagram.svg', 'sha-s', 10, 'image/svg+xml')`,
    ).rejects.toThrow();
  });

  it('keeps a file over 50 MB as a row with no copy', async () => {
    const [row] = await admin<{ id: string }[]>`
      insert into attachments (user_id, connection_id, path, blob_sha, size_bytes, mime_type)
      values (${userA}, ${connectionA}, 'Attachments/long.wav', 'sha-w', 52428801, 'audio/wav')
      returning id`;
    expect(row.id).toBeTruthy();
    await admin`delete from attachments where id = ${row.id}`;
  });
});

describe('transcripts and courses, across users (plan #1306)', () => {
  it('shows each account its own transcripts and courses only', async () => {
    for (const [user, other] of [[userA, userB], [userB, userA]]) {
      const transcripts = await asUser(user, (tx) => tx<{ user_id: string }[]>`select user_id from transcripts`);
      const courses = await asUser(user, (tx) => tx<{ user_id: string }[]>`select user_id from courses`);
      expect(transcripts.map((r) => r.user_id)).toEqual([user]);
      expect(courses.map((r) => r.user_id)).toEqual([user]);
      expect(transcripts.some((r) => r.user_id === other)).toBe(false);
    }
  });

  it('lets another account neither edit nor delete them', async () => {
    const edited = await asUser(userB, (tx) => tx`
      update transcripts set school = 'Taken' where id = ${transcriptA} returning id`);
    const editedCourses = await asUser(userB, (tx) => tx`
      update courses set grade = 'F' where transcript_id = ${transcriptA} returning id`);
    const deleted = await asUser(userB, (tx) => tx`
      delete from transcripts where id = ${transcriptA} returning id`);
    expect([edited.length, editedCourses.length, deleted.length]).toEqual([0, 0, 0]);

    const [row] = await admin<{ school: string }[]>`select school from transcripts where id = ${transcriptA}`;
    expect(row.school).toBe('State University');
  });

  it("refuses a course filed on another account's transcript, or a row in another's name", async () => {
    await expect(
      asUser(userB, (tx) => tx`
        insert into courses (user_id, transcript_id, school, title, position)
        values (${userB}, ${transcriptA}, 'State University', 'Planted', 1)`),
    ).rejects.toThrow();
    await expect(
      asUser(userB, (tx) => tx`
        insert into transcripts (user_id, school, file_name, storage_path, mime_type, size_bytes)
        values (${userA}, 'Elsewhere', 'x.pdf', ${`${userA}/planted.pdf`}, 'application/pdf', 1)`),
    ).rejects.toThrow();
  });

  it("refuses a file outside the owner's folder, an unkept type and an oversized file", async () => {
    await expect(
      admin`insert into transcripts (user_id, school, file_name, storage_path, mime_type, size_bytes)
            values (${userA}, 'S', 'x.pdf', ${`${userB}/x.pdf`}, 'application/pdf', 1)`,
    ).rejects.toThrow();
    await expect(
      admin`insert into transcripts (user_id, school, file_name, storage_path, mime_type, size_bytes)
            values (${userA}, 'S', 'x.svg', ${`${userA}/x.svg`}, 'image/svg+xml', 1)`,
    ).rejects.toThrow();
    await expect(
      admin`insert into transcripts (user_id, school, file_name, storage_path, mime_type, size_bytes)
            values (${userA}, 'S', 'x.pdf', ${`${userA}/big.pdf`}, 'application/pdf', 20971521)`,
    ).rejects.toThrow();
  });

  it('keeps each account to its own folder of the vault-transcripts bucket', async () => {
    // The bucket's policies are this function and the bucket id; the local
    // database has no storage schema, so the function is what is checked.
    const own = (user: string, name: string) =>
      asUser(user, (tx) => tx<{ ok: boolean }[]>`select obsidian.transcript_file_is_own(${name}) as ok`)
        .then(([row]) => row.ok);

    expect(await own(userA, `${userA}/t-record.pdf`)).toBe(true);
    expect(await own(userB, `${userA}/t-record.pdf`)).toBe(false);
    expect(await own(userA, `${userB}/t-record.pdf`)).toBe(false);
    // A bare name at the bucket root, even one that is the user id, is nobody's.
    expect(await own(userA, userA)).toBe(false);
    expect(await own(userA, `${userA}/`)).toBe(false);
  });

  it('takes the courses with the transcript', async () => {
    const [extra] = await admin<{ id: string }[]>`
      insert into transcripts (user_id, school, file_name, storage_path, mime_type, size_bytes)
      values (${userB}, 'College', 'pasted.txt', ${`${userB}/p-pasted.txt`}, 'text/plain', 10)
      returning id`;
    await admin`
      insert into courses (user_id, transcript_id, school, title, position)
      values (${userB}, ${extra.id}, 'College', 'Transfer credit', 0)`;

    const deleted = await asUser(userB, (tx) => tx`delete from transcripts where id = ${extra.id} returning id`);
    expect(deleted).toHaveLength(1);
    const left = await admin`select id from courses where transcript_id = ${extra.id}`;
    expect(left).toHaveLength(0);
    const [kept] = await admin<{ n: number }[]>`
      select count(*)::int as n from courses where transcript_id = ${transcriptB}`;
    expect(kept.n).toBe(1);
  });
});
