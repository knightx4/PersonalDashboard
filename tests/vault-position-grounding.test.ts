/**
 * A position is marked no longer grounded when its last live quote goes, and
 * the mark clears when one comes back (plan #2446.1), against Postgres.
 *
 * The triggers in vault 0039 do the work, so this drives them the way the app
 * would: a quote row deleted and put back, a note soft-deleted and restored,
 * with a second position on another note to show only the affected one moves.
 * The position row is checked to still be there after each step.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asUser, closeDb, createUser, truncateAll } from './helpers/db-vault';

let userA = '';
let connection = '';
let positionOne = '';
let positionTwo = '';
let noteParking = '';
let noteStreets = '';

const QUOTE = 'Surface parking is among the worst things to happen to cities.';

async function addNote(path: string, body: string): Promise<string> {
  const [note] = await admin<{ id: string }[]>`
    insert into notes (user_id, connection_id, path, title, body, blob_sha, size_bytes, git_updated_at)
    values (${userA}, ${connection}, ${path}, ${path}, ${body}, ${'sha-' + path}, ${body.length}, now())
    returning id`;
  return note.id;
}

async function addPosition(name: string): Promise<string> {
  const [row] = await admin<{ id: string }[]>`
    insert into positions (user_id, name, statement, basis, kind, stance)
    values (${userA}, ${name}, ${name + '.'}, 'Stated in the note.', 'claim', 'held')
    returning id`;
  return row.id;
}

async function addQuote(positionId: string, noteId: string, quote: string): Promise<void> {
  await admin`
    insert into position_sources (user_id, position_id, note_id, quote, blob_sha)
    values (${userA}, ${positionId}, ${noteId}, ${quote}, 'sha')`;
}

async function mark(positionId: string): Promise<Date | null | undefined> {
  const [row] = await admin<{ ungrounded_at: Date | null }[]>`
    select ungrounded_at from positions where id = ${positionId}`;
  return row?.ungrounded_at;
}

beforeAll(async () => {
  await truncateAll();
  userA = await createUser('grounding-a@example.com');
  const [conn] = await admin<{ id: string }[]>`
    insert into vault_connections (user_id, repo_owner, repo_name, branch, access_token)
    values (${userA}, 'alice', 'alice-vault', 'main', 'encrypted')
    returning id`;
  connection = conn.id;
  noteParking = await addNote('Cities/Parking.md', QUOTE);
  noteStreets = await addNote('Cities/Streets.md', 'Streets are for people.');
  positionOne = await addPosition('Surface parking harms cities');
  positionTwo = await addPosition('Streets are for people');
  await addQuote(positionOne, noteParking, QUOTE);
  await addQuote(positionTwo, noteStreets, 'Streets are for people.');
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

describe('position grounding', () => {
  it('starts grounded', async () => {
    expect(await mark(positionOne)).toBeNull();
    expect(await mark(positionTwo)).toBeNull();
  });

  it('marks the position when its last quote is deleted, and keeps the row', async () => {
    await admin`delete from position_sources where position_id = ${positionOne}`;
    expect(await mark(positionOne)).toBeInstanceOf(Date);
    expect(await mark(positionTwo)).toBeNull();
  });

  it('clears the mark when the quote is put back', async () => {
    await addQuote(positionOne, noteParking, QUOTE);
    expect(await mark(positionOne)).toBeNull();
  });

  it('marks the position when its last note is soft-deleted, and keeps the row', async () => {
    await admin`update notes set deleted_at = now() where id = ${noteParking}`;
    expect(await mark(positionOne)).toBeInstanceOf(Date);
    expect(await mark(positionTwo)).toBeNull();
  });

  it('keeps the first time it was marked when the note changes again while deleted', async () => {
    const first = await mark(positionOne);
    await admin`update notes set title = 'Parking, again' where id = ${noteParking}`;
    expect(await mark(positionOne)).toEqual(first);
  });

  it('clears the mark when the note is restored', async () => {
    await admin`update notes set deleted_at = null where id = ${noteParking}`;
    expect(await mark(positionOne)).toBeNull();
  });

  it('stays grounded while one live quote remains', async () => {
    await addQuote(positionOne, noteStreets, 'Streets are for people.');
    await admin`update notes set deleted_at = now() where id = ${noteParking}`;
    expect(await mark(positionOne)).toBeNull();
    await admin`delete from position_sources where position_id = ${positionOne} and note_id = ${noteStreets}`;
    expect(await mark(positionOne)).toBeInstanceOf(Date);
  });

  it('does not clear the mark for a quote on a deleted note', async () => {
    await addQuote(positionOne, noteParking, 'Another sentence.');
    expect(await mark(positionOne)).toBeInstanceOf(Date);
  });

  it('settles the mark when the signed-in person soft-deletes and restores a note', async () => {
    await asUser(userA, (tx) => tx`update notes set deleted_at = now() where id = ${noteStreets}`);
    expect(await mark(positionTwo)).toBeInstanceOf(Date);
    await asUser(userA, (tx) => tx`update notes set deleted_at = null where id = ${noteStreets}`);
    expect(await mark(positionTwo)).toBeNull();
  });
});
