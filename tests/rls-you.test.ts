/**
 * Cross-user isolation for the you schema (plan #1991): what is true about
 * the person. Every table here is theirs alone, and the coverage test below
 * makes a new one fail until it is checked here too.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asUser, closeDb, createUser, truncateAll } from './helpers/db-you';

let userA = '';
let userB = '';

beforeAll(async () => {
  await truncateAll();
  userA = await createUser('you-a@example.com');
  userB = await createUser('you-b@example.com');
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

describe('coverage', () => {
  it('checks every table, so a new one cannot skip the isolation check', async () => {
    const rows = await admin<{ tablename: string }[]>`
      select c.relname as tablename
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'you' and c.relkind = 'r'
      order by 1`;
    expect(rows.map((r) => r.tablename)).toEqual(['course_files', 'courses', 'details','personality_results', 'places', 'transcripts', 'work_history']);
  });

  it('has row level security on every table', async () => {
    const rows = await admin<{ tablename: string }[]>`
      select c.relname as tablename
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'you' and c.relkind = 'r' and not c.relrowsecurity`;
    expect(rows).toEqual([]);
  });
});

describe('personality test results', () => {
  // migrations-learn/0092_personality_results.sql (plan #1631), moved to
  // you by migrations-you/0004 (#1991.2). One row per test taken or
  // typed in; a retake is a second row, and Dash's read sits on the result.
  const answers = admin.json(Array.from({ length: 50 }, (_, i) => (i % 5) + 1));

  it('saves a result and reads it back, to its owner only', async () => {
    await asUser(
      userA,
      (tx) => tx`insert into personality_results (user_id, kind, test_name, answers, extraversion,
                   agreeableness, conscientiousness, emotional_stability, intellect, taken_at)
                 values (${userA}, 'big_five', 'Big Five', ${answers}, 22, 38, 31, 27, 44,
                         '2026-10-01')`,
    );
    await asUser(
      userA,
      (tx) => tx`insert into personality_results (user_id, kind, test_name, typed_value, taken_at)
                 values (${userA}, 'enneagram', 'Enneagram', '5w4', '2023-05-12')`,
    );
    const own = await asUser(
      userA,
      (tx) => tx`select kind, extraversion, intellect, typed_value, taken_at::text as taken_at,
                        jsonb_array_length(answers) as n
                 from personality_results order by taken_at desc`,
    );
    expect(own).toEqual([
      { kind: 'big_five', extraversion: 22, intellect: 44, typed_value: null, taken_at: '2026-10-01', n: 50 },
      { kind: 'enneagram', extraversion: null, intellect: null, typed_value: '5w4', taken_at: '2023-05-12', n: null },
    ]);
    expect(await asUser(userB, (tx) => tx`select id from personality_results`)).toHaveLength(0);
  });

  it("does not let a user write or change another account's result", async () => {
    await expect(
      asUser(
        userB,
        (tx) => tx`insert into personality_results (user_id, kind, test_name, typed_value)
                   values (${userA}, 'mbti', 'Myers-Briggs', 'ESTP')`,
      ),
    ).rejects.toThrow();
    await asUser(userB, (tx) => tx`update personality_results set typed_value = 'ESTP'`);
    await asUser(userB, (tx) => tx`delete from personality_results`);
    const left = await admin`select id from personality_results where user_id = ${userA}`;
    expect(left).toHaveLength(2);
  });

  it('refuses a result of the wrong shape, and a half-written read', async () => {
    await expect(
      admin`insert into personality_results (user_id, kind, test_name, typed_value)
            values (${userA}, 'big_five', 'Big Five', 'high')`,
    ).rejects.toThrow();
    await expect(
      admin`insert into personality_results (user_id, kind, test_name, answers, extraversion,
              agreeableness, conscientiousness, emotional_stability, intellect)
            values (${userA}, 'big_five', 'Big Five', ${answers}, 9, 38, 31, 27, 44)`,
    ).rejects.toThrow();
    await expect(
      admin`insert into personality_results (user_id, kind, test_name)
            values (${userA}, 'mbti', 'Myers-Briggs')`,
    ).rejects.toThrow();
    await expect(
      admin`insert into personality_results (user_id, kind, test_name, typed_value)
            values (${userA}, 'astrology', 'Stars', 'Leo')`,
    ).rejects.toThrow();
    await expect(
      admin`update personality_results set read_points = '[]'::jsonb where user_id = ${userA}`,
    ).rejects.toThrow();
  });
});

describe('personal details', () => {
  // migrations-you/0007_details.sql (plan #2124.1): one row per person.
  it('keeps one row each, named by a fixed title, to its owner only', async () => {
    await asUser(
      userA,
      (tx) => tx`insert into details (user_id, phone, race) values (${userA}, '555-0100', 'Asian')`,
    );
    const own = await asUser(userA, (tx) => tx`select title, phone, race, gender from details`);
    expect(own).toEqual([{ title: 'Personal details', phone: '555-0100', race: 'Asian', gender: null }]);
    expect(await asUser(userB, (tx) => tx`select user_id from details`)).toHaveLength(0);
    await expect(
      asUser(userA, (tx) => tx`insert into details (user_id, phone) values (${userA}, '555-0101')`),
    ).rejects.toThrow();
  });

  it("does not let a user write or change another account's details", async () => {
    await expect(
      asUser(userB, (tx) => tx`insert into details (user_id, phone) values (${userA}, '999')`),
    ).rejects.toThrow();
    await asUser(userB, (tx) => tx`update details set phone = '999'`);
    await asUser(userB, (tx) => tx`delete from details`);
    const left = await admin`select phone from details where user_id = ${userA}`;
    expect(left).toEqual([{ phone: '555-0100' }]);
  });

  it('refuses a detail past its length', async () => {
    await expect(admin`update details set phone = ${'5'.repeat(201)} where user_id = ${userA}`).rejects.toThrow();
  });
});

describe('course files', () => {
  // migrations-you/0008_course_files.sql (plan #2401.1): the syllabus,
  // slides, lecture notes and readings kept under a course.
  const pdf = 'application/pdf';
  let courseA = '';
  let transcriptA = '';

  beforeAll(async () => {
    const [t] = await admin<{ id: string }[]>`
      insert into transcripts (user_id, school, file_name, storage_path, mime_type, size_bytes)
      values (${userA}, 'State University', 'record.pdf', ${`${userA}/t-record.pdf`}, ${pdf}, 1)
      returning id`;
    transcriptA = t.id;
    const [c] = await admin<{ id: string }[]>`
      insert into courses (user_id, transcript_id, school, title, position)
      values (${userA}, ${transcriptA}, 'State University', 'Intro to Economics', 0)
      returning id`;
    courseA = c.id;
  });

  const insertFile = (
    user: string,
    owner: string,
    course: string,
    name: string,
    extra: Record<string, string | number> = {},
  ) => {
    const row = {
      user_id: owner,
      course_id: course,
      kind: 'reading',
      title: name,
      file_name: name,
      storage_path: `${owner}/${course}/${name}`,
      mime_type: pdf,
      size_bytes: 1,
      ...extra,
    };
    return asUser(user, (tx) => tx`insert into course_files ${tx(row)} returning id`);
  };

  it('keeps a file under its course, to its owner only', async () => {
    await insertFile(userA, userA, courseA, 'syllabus.pdf', { kind: 'syllabus' });
    await insertFile(userA, userA, courseA, 'week-1.pptx', {
      kind: 'slides',
      week: 1,
      mime_type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    });
    const own = await asUser(userA, (tx) => tx`select kind, week from course_files order by kind`);
    expect(own).toEqual([
      { kind: 'slides', week: 1 },
      { kind: 'syllabus', week: null },
    ]);
    expect(await asUser(userB, (tx) => tx`select id from course_files`)).toHaveLength(0);
  });

  it("refuses a file on another account's course, or in another account's folder", async () => {
    await expect(insertFile(userB, userB, courseA, 'planted.pdf')).rejects.toThrow();
    await expect(insertFile(userB, userA, courseA, 'planted.pdf')).rejects.toThrow();
    await expect(
      insertFile(userA, userA, courseA, 'elsewhere.pdf', { storage_path: `${userA}/other-course/elsewhere.pdf` }),
    ).rejects.toThrow();
    await asUser(userB, (tx) => tx`delete from course_files`);
    expect(await admin`select id from course_files where user_id = ${userA}`).toHaveLength(2);
  });

  it('refuses an unknown kind, an unkept type and a file over 20 MB', async () => {
    await expect(insertFile(userA, userA, courseA, 'a.pdf', { kind: 'homework' })).rejects.toThrow();
    await expect(insertFile(userA, userA, courseA, 'a.svg', { mime_type: 'image/svg+xml' })).rejects.toThrow();
    await expect(insertFile(userA, userA, courseA, 'a.pdf', { size_bytes: 20971521 })).rejects.toThrow();
  });

  it('refuses a 21st file on one course', async () => {
    for (let i = 2; i < 20; i++) await insertFile(userA, userA, courseA, `reading-${i}.pdf`);
    expect(await admin`select id from course_files where course_id = ${courseA}`).toHaveLength(20);
    await expect(insertFile(userA, userA, courseA, 'reading-20.pdf')).rejects.toThrow(/at most 20/);
  });

  it('keeps each account to its own folder of the you-course-files bucket', async () => {
    const own = (user: string, name: string) =>
      asUser(user, (tx) => tx<{ ok: boolean }[]>`select you.course_file_is_own(${name}) as ok`)
        .then(([row]) => row.ok);

    expect(await own(userA, `${userA}/${courseA}/f-a.pdf`)).toBe(true);
    expect(await own(userB, `${userA}/${courseA}/f-a.pdf`)).toBe(false);
    expect(await own(userA, `${userA}/f-a.pdf`)).toBe(false);
    expect(await own(userA, `${userA}/${courseA}/`)).toBe(false);
  });

  it('takes the files with the course, and the course with its transcript', async () => {
    await asUser(userA, (tx) => tx`delete from transcripts where id = ${transcriptA}`);
    expect(await admin`select id from course_files where course_id = ${courseA}`).toHaveLength(0);
  });
});
