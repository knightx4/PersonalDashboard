/**
 * Cross-user isolation for the learn module, written before any feature code.
 *
 * The same rule as build step 2, applied to a fifth schema: a table that
 * arrives without a policy has to fail here, immediately, rather than in
 * production months later. The coverage test below is what forces this file to
 * be updated whenever the schema grows.
 *
 * Two things here are worth more than the usual "can B read A's rows". The
 * first is `tracks.question` -- the thing you were stuck on, in your own
 * words -- which is closer in kind to a vault note than to an order. The
 * second is the composite foreign keys: readings join their two parents on
 * (id, user_id) precisely because a plain foreign key bypasses RLS and would
 * happily accept another account's track. That is a database-level claim and
 * it is asserted rather than assumed.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asUser, closeDb, createUser, truncateAll } from './helpers/db-learn';

let userA = '';
let userB = '';
let trackA = '';
let trackB = '';
let sourceA = '';
let sourceB = '';
let readingA = '';

async function seedTrack(userId: string, title: string, question: string): Promise<string> {
  const [row] = await admin<{ id: string }[]>`
    insert into tracks (user_id, title, question)
    values (${userId}, ${title}, ${question})
    returning id`;
  return row.id;
}

async function seedSource(userId: string, title: string, url: string): Promise<string> {
  const [row] = await admin<{ id: string }[]>`
    insert into sources (user_id, title, author, kind, canonical_url, access)
    values (${userId}, ${title}, 'Hayek', 'article', ${url}, 'open')
    returning id`;
  return row.id;
}

async function seedReading(
  userId: string,
  trackId: string,
  sourceId: string,
  basis: string,
): Promise<string> {
  const [row] = await admin<{ id: string }[]>`
    insert into readings (user_id, track_id, source_id, locator_basis, locator_label)
    values (${userId}, ${trackId}, ${sourceId}, ${basis}, 'Whole essay')
    returning id`;
  return row.id;
}

beforeAll(async () => {
  await truncateAll();
  userA = await createUser('learn-a@example.com');
  userB = await createUser('learn-b@example.com');

  trackA = await seedTrack(userA, 'Value and price', 'Why does price break down when endowments differ?');
  trackB = await seedTrack(userB, 'Bob reads things', 'Bob has his own question.');

  sourceA = await seedSource(userA, 'The Use of Knowledge in Society', 'https://example.org/a');
  sourceB = await seedSource(userB, 'The Use of Knowledge in Society', 'https://example.org/b');

  readingA = await seedReading(userA, trackA, sourceA, 'Found verbatim in the fetched page.');
  await seedReading(userB, trackB, sourceB, 'Model knowledge, unconfirmed.');

  await admin`
    insert into imports (user_id, track_id, raw_text, source_hint)
    values (${userA}, ${trackA}, 'Sen, Walzer, Dworkin, Hayek, Weyl', 'claude')`;
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
      where n.nspname = 'learn' and c.relkind = 'r' and not c.relrowsecurity
      order by 1`;
    expect(rows.map((r) => r.tablename)).toEqual([]);
  });

  // The graph half of the schema, and the quiz tables, are seeded and checked
  // in rls-learn-graph.test.ts. They are listed here so this assertion keeps
  // doing its job: a table that arrives with no isolation test anywhere breaks
  // this line first.
  it('seeds every table, so a new one cannot skip the isolation check', async () => {
    const rows = await admin<{ tablename: string }[]>`
      select c.relname as tablename
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'learn' and c.relkind = 'r'
      order by 1`;
    expect(rows.map((r) => r.tablename)).toEqual([
      'concept_edges',
      'concept_mentions',
      'concept_state',
      'concepts',
      'goals',
      'imports',
      'opening_questions',
      'opening_sweeps',
      'probes',
      'quiz_questions',
      'quiz_sources',
      'quizzes',
      'readings',
      'sources',
      'subjects',
      'tracks',
    ]);
  });
});

describe('cross-user reads', () => {
  it('shows the owner their tracks, sources, readings and imports', async () => {
    const seen = await asUser(userA, async (tx) => ({
      tracks: (await tx`select id from tracks`).length,
      sources: (await tx`select id from sources`).length,
      readings: (await tx`select id from readings`).length,
      imports: (await tx`select id from imports`).length,
    }));
    expect(seen).toEqual({ tracks: 1, sources: 1, readings: 1, imports: 1 });
  });

  it('shows another user none of it', async () => {
    const seen = await asUser(userB, async (tx) => ({
      tracks: (await tx`select id from tracks where id = ${trackA}`).length,
      sources: (await tx`select id from sources where id = ${sourceA}`).length,
      readings: (await tx`select id from readings where id = ${readingA}`).length,
      imports: (await tx`select id from imports where track_id = ${trackA}`).length,
    }));
    expect(seen).toEqual({ tracks: 0, sources: 0, readings: 0, imports: 0 });
  });

  it('does not leak the question behind a track', async () => {
    // The question is the closest thing in this schema to a private note: it
    // is what you did not understand, written in your own words.
    const rows = await asUser(
      userB,
      (tx) => tx`select question from tracks where question ilike '%endowments%'`,
    );
    expect(rows).toHaveLength(0);
  });

  it('does not leak what somebody wrote about what they read', async () => {
    await admin`update readings set note = 'This changed my mind about prices.'
                where id = ${readingA}`;

    const rows = await asUser(
      userB,
      (tx) => tx`select note from readings where note is not null`,
    );
    expect(rows).toHaveLength(0);
  });

  it('does not leak a source that only shares a title with your own', async () => {
    // Both users have the Hayek essay. Sources are deduped per user, and a
    // title is not an identifier anyone else can reach a row through.
    const rows = await asUser(
      userB,
      (tx) => tx`select id, canonical_url from sources
                 where title = 'The Use of Knowledge in Society'`,
    );
    expect(rows).toHaveLength(1);
    expect((rows[0] as { id: string }).id).toBe(sourceB);
  });

  it('does not leak the pasted text an import was built from', async () => {
    // A paste can carry a whole conversation's worth of context around it.
    const rows = await asUser(
      userB,
      (tx) => tx`select raw_text from imports where raw_text ilike '%Walzer%'`,
    );
    expect(rows).toHaveLength(0);
  });
});

describe('cross-user writes', () => {
  it('does not let another user edit or delete a reading', async () => {
    const edited = await asUser(
      userB,
      (tx) => tx`update readings set status = 'read' where id = ${readingA} returning id`,
    );
    expect(edited).toHaveLength(0);

    const deleted = await asUser(
      userB,
      (tx) => tx`delete from readings where id = ${readingA} returning id`,
    );
    expect(deleted).toHaveLength(0);
  });

  it('does not let another user retitle or shelve your track', async () => {
    const affected = await asUser(
      userB,
      (tx) => tx`update tracks set status = 'shelved' where id = ${trackA} returning id`,
    );
    expect(affected).toHaveLength(0);
  });

  it('does not let another user repoint a source at a URL of their choosing', async () => {
    // The attack: change where somebody's Open button goes, and they click it.
    const affected = await asUser(
      userB,
      (tx) => tx`update sources set canonical_url = 'https://mallory.example/payload'
                 where id = ${sourceA} returning id`,
    );
    expect(affected).toHaveLength(0);
  });

  it('does not let another user file a reading into your track', async () => {
    // with check, not just using: putting a reading of your choosing in front
    // of somebody else's eyes is the whole of the attack.
    await expect(
      asUser(
        userB,
        (tx) => tx`insert into readings (user_id, track_id, source_id, locator_basis)
                   values (${userB}, ${trackA}, ${sourceB}, 'planted')`,
      ),
    ).rejects.toThrow();
  });

  it('refuses a reading whose track and source belong to different accounts', async () => {
    // Not RLS -- this one is the composite foreign key, and it fires even for
    // the admin connection that bypasses every policy. Foreign keys bypass row
    // level security, so `references tracks (id)` alone would have accepted
    // this row and the policy would never have been asked.
    await expect(
      admin`insert into readings (user_id, track_id, source_id, locator_basis)
            values (${userA}, ${trackA}, ${sourceB}, 'mismatched owners')`,
    ).rejects.toThrow();
  });

  it('refuses an import filed against another account\'s track', async () => {
    await expect(
      admin`insert into imports (user_id, track_id, raw_text)
            values (${userA}, ${trackB}, 'not mine')`,
    ).rejects.toThrow();
  });
});

describe('a reading you wrote down yourself', () => {
  it('is allowed to have no source', async () => {
    // The point of the whole change: the first thing you write down is a
    // subject, not a book.
    const [row] = await admin<{ id: string; title: string }[]>`
      insert into readings (user_id, track_id, source_id, title, locator_basis)
      values (${userA}, ${trackA}, null, 'How central banks set rates',
              'You wrote this down yourself.')
      returning id, title`;
    expect(row.title).toBe('How central banks set rates');

    await admin`delete from readings where id = ${row.id}`;
  });

  it('refuses a reading that is about nothing at all', async () => {
    // Neither a source nor a title renders as a blank line you cannot click,
    // delete or explain.
    await expect(
      admin`insert into readings (user_id, track_id, source_id, title, locator_basis)
            values (${userA}, ${trackA}, null, null, 'nothing')`,
    ).rejects.toThrow();

    await expect(
      admin`insert into readings (user_id, track_id, source_id, title, locator_basis)
            values (${userA}, ${trackA}, null, '   ', 'nothing')`,
    ).rejects.toThrow();
  });

  it('lets a source-backed reading carry your own title as well', async () => {
    const [row] = await admin<{ id: string }[]>`
      insert into readings (user_id, track_id, source_id, title, locator_basis)
      values (${userA}, ${trackA}, ${sourceA}, 'the coordination argument', 'fetched')
      returning id`;
    expect(row.id).toBeTruthy();
    await admin`delete from readings where id = ${row.id}`;
  });

  it('stays hidden from another user like any other reading', async () => {
    const [row] = await admin<{ id: string }[]>`
      insert into readings (user_id, track_id, source_id, title, locator_basis)
      values (${userA}, ${trackA}, null, 'A private curiosity', 'typed')
      returning id`;

    const seen = await asUser(userB, (tx) => tx`select id from readings where id = ${row.id}`);
    expect(seen).toHaveLength(0);

    await admin`delete from readings where id = ${row.id}`;
  });
});

describe('deleting', () => {
  it('takes a track\'s readings and its import with it', async () => {
    // The reason there is nothing to clean up in deleteTrack: the foreign keys
    // do it. If they ever stopped, this fails rather than leaving orphans
    // nobody can see or reach.
    const track = await seedTrack(userA, 'Going', 'Does this cascade?');
    const reading = await seedReading(userA, track, sourceA, 'fetched');
    await admin`insert into imports (user_id, track_id, raw_text)
                values (${userA}, ${track}, 'paste')`;

    await admin`delete from tracks where id = ${track}`;

    const left = await admin<{ n: number }[]>`
      select (select count(*) from readings where id = ${reading})
           + (select count(*) from imports where track_id = ${track}) as n`;
    expect(Number(left[0].n)).toBe(0);
  });

  it('leaves the source alone, because another track may still want it', async () => {
    // Sources are deduped across tracks. Deleting one track must not take a
    // work a different track still points at.
    const track = await seedTrack(userA, 'Going too', 'And this?');
    await seedReading(userA, track, sourceA, 'fetched');

    await admin`delete from tracks where id = ${track}`;

    const source = await admin`select id from sources where id = ${sourceA}`;
    expect(source).toHaveLength(1);
  });

  it('does not let another user delete your reading or your track', async () => {
    const deletedReading = await asUser(
      userB,
      (tx) => tx`delete from readings where id = ${readingA} returning id`,
    );
    expect(deletedReading).toHaveLength(0);

    const deletedTrack = await asUser(
      userB,
      (tx) => tx`delete from tracks where id = ${trackA} returning id`,
    );
    expect(deletedTrack).toHaveLength(0);
  });

  it('lets the owner delete their own reading', async () => {
    const id = await seedReading(userA, trackA, sourceA, 'fetched');
    const gone = await asUser(userA, (tx) => tx`delete from readings where id = ${id} returning id`);
    expect(gone).toHaveLength(1);
  });
});

describe('the rules the schema itself enforces', () => {
  it('refuses a locator with no stated basis', async () => {
    // "Never send someone to a page that is not there" is a check constraint,
    // not a convention: a location with no basis is exactly the silent guess
    // the module forbids.
    await expect(
      admin`insert into readings (user_id, track_id, source_id, locator_basis)
            values (${userA}, ${trackA}, ${sourceA}, '   ')`,
    ).rejects.toThrow();
  });

  it('refuses a price on a source nobody has to pay for', async () => {
    await expect(
      admin`insert into sources (user_id, title, access, price_cents)
            values (${userA}, 'Free thing', 'open', 1000)`,
    ).rejects.toThrow();
  });

  it('refuses a page range that runs backwards', async () => {
    await expect(
      admin`insert into readings (user_id, track_id, source_id, locator_basis, page_from, page_to)
            values (${userA}, ${trackA}, ${sourceA}, 'from a toc', 128, 95)`,
    ).rejects.toThrow();
  });

  it('refuses a non-https open url', async () => {
    await expect(
      admin`insert into readings (user_id, track_id, source_id, locator_basis, open_url)
            values (${userA}, ${trackA}, ${sourceA}, 'fetched', 'http://insecure.example/x')`,
    ).rejects.toThrow();
  });

  it('stamps started_at and finished_at from the status, not from the caller', async () => {
    const id = await seedReading(userA, trackA, sourceA, 'fetched');

    await admin`update readings set status = 'reading' where id = ${id}`;
    const [reading] = await admin<{ started_at: string | null; finished_at: string | null }[]>`
      select started_at, finished_at from readings where id = ${id}`;
    expect(reading.started_at).not.toBeNull();
    expect(reading.finished_at).toBeNull();

    await admin`update readings set status = 'read' where id = ${id}`;
    const [done] = await admin<{ finished_at: string | null }[]>`
      select finished_at from readings where id = ${id}`;
    expect(done.finished_at).not.toBeNull();

    // Reopening it clears the finish. A finished_at outliving the status that
    // justified it is how a progress bar starts lying.
    await admin`update readings set status = 'queued' where id = ${id}`;
    const [reopened] = await admin<{ finished_at: string | null }[]>`
      select finished_at from readings where id = ${id}`;
    expect(reopened.finished_at).toBeNull();

    await admin`delete from readings where id = ${id}`;
  });

  it('finishes an abandoned reading too', async () => {
    // Giving up ends a reading as surely as finishing it does. What separates
    // them is the status, and /learn counts only `read` toward progress.
    const id = await seedReading(userA, trackA, sourceA, 'fetched');
    await admin`update readings set status = 'abandoned' where id = ${id}`;

    const [row] = await admin<{ finished_at: string | null }[]>`
      select finished_at from readings where id = ${id}`;
    expect(row.finished_at).not.toBeNull();

    await admin`delete from readings where id = ${id}`;
  });
});

/**
 * The link a gap-queued reading carries back to the concept it came from.
 *
 * It is what lets the source search read that subject's graph, so it is worth
 * the same scrutiny as the other two parents: keyed on (concept_id, user_id),
 * because a plain foreign key bypasses RLS and would take another account's
 * concept without complaint.
 */
describe('a reading queued from a gap', () => {
  async function seedConcept(userId: string, name: string): Promise<string> {
    const [subject] = await admin<{ id: string }[]>`
      insert into subjects (user_id, name) values (${userId}, ${`${name} subject`})
      returning id`;
    const [concept] = await admin<{ id: string }[]>`
      insert into concepts (user_id, subject_id, name, claim, basis)
      values (${userId}, ${subject.id}, ${name}, 'A claim you can be wrong about.',
              'Written by hand for this test.')
      returning id`;
    return concept.id;
  }

  it('refuses a concept belonging to somebody else', async () => {
    const conceptB = await seedConcept(userB, 'bob concept');

    await expect(
      admin`insert into readings (user_id, track_id, source_id, locator_basis, concept_id)
            values (${userA}, ${trackA}, ${sourceA}, 'from a gap', ${conceptB})`,
    ).rejects.toThrow();
  });

  it('survives the concept being deleted, with the link cleared', async () => {
    // A reading lives in a track and is yours to read whatever happens to the
    // graph it came from. Losing the rooting is the cost; losing the row would
    // be the queue tidying itself away behind you.
    const conceptA = await seedConcept(userA, 'alice concept');

    const [row] = await admin<{ id: string }[]>`
      insert into readings (user_id, track_id, source_id, locator_basis, concept_id)
      values (${userA}, ${trackA}, ${sourceA}, 'from a gap', ${conceptA})
      returning id`;

    await admin`delete from concepts where id = ${conceptA}`;

    const [after] = await admin<{ concept_id: string | null }[]>`
      select concept_id from readings where id = ${row.id}`;
    expect(after).toBeDefined();
    expect(after.concept_id).toBeNull();

    await admin`delete from readings where id = ${row.id}`;
  });
});

describe('account deletion', () => {
  it('takes the whole module with it, on the foreign keys', async () => {
    // The delete-account route ends at auth.admin.deleteUser(). Four more
    // tables must not be four more things for it to remember.
    const doomed = await createUser('learn-doomed@example.com');
    const track = await seedTrack(doomed, 'Going away', 'Does this survive?');
    const source = await seedSource(doomed, 'Doomed source', 'https://example.org/doomed');
    await seedReading(doomed, track, source, 'fetched');
    await admin`insert into imports (user_id, track_id, raw_text)
                values (${doomed}, ${track}, 'paste')`;

    await admin`delete from auth.users where id = ${doomed}`;

    const left = await admin<{ n: number }[]>`
      select (select count(*) from tracks where user_id = ${doomed})
           + (select count(*) from sources where user_id = ${doomed})
           + (select count(*) from readings where user_id = ${doomed})
           + (select count(*) from imports where user_id = ${doomed}) as n`;
    expect(Number(left[0].n)).toBe(0);
  });
});
