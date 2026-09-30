/**
 * Courses in search by meaning (plan #1309, migration 0139).
 *
 * core.memory_sources takes one row per transcript with saved courses, the
 * courses as lines. Checked here: the text a row is embedded as, a transfer
 * course naming its own school, a transcript with no courses left out, a new
 * transcript read as stale for the next sweep, and an edited course changing
 * the hash.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asUser, closeDb, createUser, truncateAll } from './helpers/db-core';

type Source = {
  user_id: string;
  source_table: string;
  source_ref: string;
  title: string | null;
  my_text: string | null;
  dash_text: string | null;
  source_hash: string;
};

let me = '';
let other = '';
let transcript = '';
let empty = '';
let course = '';

const transcripts = async (user: string | null = null) =>
  (await admin<Source[]>`select * from core.memory_sources(${user}::uuid)`).filter(
    (row) => row.source_table === 'obsidian.transcripts',
  );

async function addTranscript(user: string, school: string, name: string): Promise<string> {
  const [row] = await admin<{ id: string }[]>`
    insert into obsidian.transcripts (user_id, school, file_name, storage_path, mime_type, size_bytes)
    values (${user}, ${school}, ${name}, ${`${user}/${crypto.randomUUID()}-${name}`}, 'application/pdf', 1000)
    returning id`;
  return row.id;
}

beforeAll(async () => {
  await truncateAll();
  me = await createUser('courses-me@example.com');
  other = await createUser('courses-other@example.com');

  transcript = await addTranscript(me, 'State University', 'record.pdf');
  const [first] = await admin<{ id: string }[]>`
    insert into obsidian.courses (user_id, transcript_id, school, code, title, term, year, credits, grade, position)
    values (${me}, ${transcript}, 'State University', 'ECON 101', 'Principles of Economics', 'Fall 2019', 2019, 3.00, 'A-', 0)
    returning id`;
  course = first.id;
  await admin`
    insert into obsidian.courses (user_id, transcript_id, school, code, title, term, year, credits, grade, position)
    values (${me}, ${transcript}, 'State University', null, 'Writing Seminar', 'Spring', 2020, 1, null, 1),
           (${me}, ${transcript}, 'City College', 'MATH 110', 'Calculus I', null, 2018, 4.5, 'B', 2)`;

  empty = await addTranscript(me, 'Night School', 'blank.pdf');

  const theirs = await addTranscript(other, 'Elsewhere', 'theirs.pdf');
  await admin`
    insert into obsidian.courses (user_id, transcript_id, school, title, position)
    values (${other}, ${theirs}, 'Elsewhere', 'Their course', 0)`;
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

describe('transcripts in memory', () => {
  it('writes one row per transcript, a line per course in order', async () => {
    const [row] = await transcripts(me);
    expect(row.source_ref).toBe(transcript);
    expect(row.title).toBe('Transcript from State University');
    expect(row.dash_text).toBeNull();
    expect(row.my_text!.split('\n')).toEqual([
      'ECON 101 Principles of Economics, Fall 2019, 3 credits, grade A-',
      'Writing Seminar, Spring 2020, 1 credit',
      'MATH 110 Calculus I, 2018, 4.5 credits, grade B, at City College',
    ]);
  });

  it('leaves out a transcript with no saved courses', async () => {
    const refs = (await transcripts()).map((row) => row.source_ref);
    expect(refs).not.toContain(empty);
    expect(refs).toHaveLength(2);
  });

  it("gives another account none of this one's", async () => {
    const theirs = await asUser(other, (tx) => tx<Source[]>`select * from core.memory_sources(null)`);
    const refs = theirs.filter((row) => row.source_table === 'obsidian.transcripts').map((row) => row.source_ref);
    expect(refs).not.toContain(transcript);
    expect(refs).toHaveLength(1);
  });

  it('reads a newly saved transcript as stale for the next sweep', async () => {
    const stale = await admin<Source[]>`select * from core.stale_memory_sources(100, ${me}::uuid)`;
    expect(stale.map((row) => row.source_ref)).toContain(transcript);
  });

  it('changes the hash when a course is edited', async () => {
    const [before] = await transcripts(me);
    await admin`update obsidian.courses set grade = 'A' where id = ${course}`;
    const [after] = await transcripts(me);
    expect(after.my_text).toContain('grade A\n');
    expect(after.source_hash).not.toBe(before.source_hash);
  });
});
