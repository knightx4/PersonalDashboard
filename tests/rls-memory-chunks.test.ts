/**
 * One person's passages, and nobody else's (plan #1246).
 *
 * core.memory_chunks holds passages of everything a person wrote, across every
 * module, in one table shared by every account. The search functions run as
 * the service role too, where RLS does not apply, so the owner filter inside
 * them is the only thing between one person's question and another person's
 * notes. These tests seed two people with identical vectors, so a leak would
 * come back as the closest match rather than hide below a threshold.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asUser, closeDb, createUser, truncateAll } from './helpers/db-core';

const VECTOR = `[${new Array(1024).fill(0.01).join(',')}]`;
/** Orthogonal-ish to VECTOR: half the dimensions positive, half negative. */
const OTHER = `[${new Array(1024).fill(0).map((_, i) => (i % 2 ? 0.01 : -0.01)).join(',')}]`;
const MODEL = 'voyage-4-lite';

let userA = '';
let userB = '';

async function seedChunk(
  userId: string,
  sourceTable: string,
  sourceRef: string,
  chunkIndex: number,
  body: string,
  vector = VECTOR,
  author: 'me' | 'dash' = 'me',
): Promise<void> {
  await admin`
    insert into memory_chunks (user_id, source_table, source_ref, chunk_index, author, body,
                               source_hash, embedding, embedding_model)
    values (${userId}, ${sourceTable}, ${sourceRef}, ${chunkIndex}, ${author}, ${body},
            ${`hash-${sourceRef}`}, ${vector}::extensions.vector, ${MODEL})`;
}

type Hit = { source_ref: string; author: string; similarity: number };

beforeAll(async () => {
  await truncateAll();
  userA = await createUser('memory-a@example.com');
  userB = await createUser('memory-b@example.com');

  await seedChunk(userA, 'obsidian.notes', 'note-a', 0, 'What I want from my next job.');
  await seedChunk(userA, 'obsidian.notes', 'note-a', 1, 'Something else entirely.', OTHER);
  await seedChunk(userA, 'job_search.thoughts', 'thought-a', 0, 'A team that ships.');
  await seedChunk(userA, 'goals.steps', 'step-a', 0, 'Dash wrote this result.', VECTOR, 'dash');
  // B's passages carry the same vectors, so any leak would rank first.
  await seedChunk(userB, 'obsidian.notes', 'note-b', 0, 'B wants a quiet life.');
  await seedChunk(userB, 'job_search.thoughts', 'thought-b', 0, 'B on land value tax.');
  // A year ref is not unique across people; the key includes the owner.
  await seedChunk(userA, 'core.year_reviews', '2025', 0, 'A year.');
  await seedChunk(userB, 'core.year_reviews', '2025', 0, 'B year.');
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

describe('memory chunks table', () => {
  it('shows each person only their own passages', async () => {
    const own = await asUser(userA, (tx) => tx`select source_ref from memory_chunks`);
    const other = await asUser(userB, (tx) => tx`select source_ref from memory_chunks`);
    expect(own.map((r) => r.source_ref).sort()).toEqual(
      ['2025', 'note-a', 'note-a', 'step-a', 'thought-a'].sort(),
    );
    expect(other.map((r) => r.source_ref).sort()).toEqual(['2025', 'note-b', 'thought-b']);
  });

  it('refuses a passage written for someone else', async () => {
    await expect(
      asUser(userB, (tx) => tx`
        insert into memory_chunks (user_id, source_table, source_ref, chunk_index, author, body,
                                   source_hash, embedding, embedding_model)
        values (${userA}, 'obsidian.notes', 'planted', 0, 'me', 'planted',
                'h', ${VECTOR}::extensions.vector, ${MODEL})`),
    ).rejects.toThrow(/row-level security/);
  });

  it('refuses an author other than me or dash', async () => {
    await expect(seedChunk(userA, 'obsidian.notes', 'bad', 0, 'x', VECTOR, 'claude' as 'me')).rejects.toThrow();
  });
});

describe('search_memory', () => {
  const search = (
    tx: import('postgres').Sql | import('postgres').TransactionSql,
    owner: string | null,
    sources: string[] | null = null,
    authors: string[] | null = null,
  ) =>
    tx<Hit[]>`
      select source_ref, author, similarity
        from search_memory(${VECTOR}, ${owner}::uuid, ${sources}::text[], 20, 0.5, ${MODEL},
                           ${authors}::text[])`;

  it('never returns another person\'s passages, even as the service role', async () => {
    const asService = await search(admin, userA);
    expect(asService.map((r) => r.source_ref).sort()).toEqual(['2025', 'note-a', 'step-a', 'thought-a']);
    expect(Number(asService[0].similarity)).toBeCloseTo(1, 5);

    const forB = await search(admin, userB);
    expect(forB.map((r) => r.source_ref).sort()).toEqual(['2025', 'note-b', 'thought-b']);
  });

  it('returns nothing when a signed-in person names someone else as the owner', async () => {
    expect(await asUser(userB, (tx) => search(tx, userA))).toEqual([]);
  });

  it('returns nothing without an owner', async () => {
    expect(await search(admin, null)).toEqual([]);
  });

  it('keeps below the floor what is not close', async () => {
    const refs = (await search(admin, userA)).map((r) => r.source_ref);
    // note-a's second passage points the other way and is not returned.
    expect(refs.filter((r) => r === 'note-a')).toHaveLength(1);
  });

  it('narrows to the tables and authors asked for', async () => {
    const notes = await search(admin, userA, ['obsidian.notes']);
    expect(notes.map((r) => r.source_ref)).toEqual(['note-a']);
    const dash = await search(admin, userA, null, ['dash']);
    expect(dash.map((r) => [r.source_ref, r.author])).toEqual([['step-a', 'dash']]);
  });
});

describe('search_memory_from', () => {
  const from = (
    tx: import('postgres').Sql | import('postgres').TransactionSql,
    owner: string,
    table: string,
    ref: string,
  ) =>
    tx<Hit[]>`
      select source_ref, author, similarity
        from search_memory_from(${owner}::uuid, ${table}, ${ref}, null, 20, 0.5)`;

  it('finds the person\'s other rows near a row, and leaves the row itself out', async () => {
    const near = await from(admin, userA, 'obsidian.notes', 'note-a');
    expect(near.map((r) => r.source_ref).sort()).toEqual(['2025', 'step-a', 'thought-a']);
  });

  it('never crosses to another person, even from a ref they share', async () => {
    const near = await from(admin, userA, 'core.year_reviews', '2025');
    expect(near.map((r) => r.source_ref)).not.toContain('note-b');
    expect(near.map((r) => r.source_ref)).not.toContain('thought-b');
    expect(await asUser(userB, (tx) => from(tx, userA, 'obsidian.notes', 'note-a'))).toEqual([]);
  });
});
