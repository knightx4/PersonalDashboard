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
    expect(rows.map((r) => r.tablename)).toEqual(['course_file_summaries', 'course_files', 'course_overviews', 'course_weeks', 'courses', 'details', 'insight_digest', 'insight_runs', 'insight_signals', 'insight_tripwires', 'insight_verdicts', 'insights', 'note_extract_reads', 'note_extracts', 'personality_results', 'places', 'profile_entries', 'transcripts', 'work_history']);
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

describe('course file summaries', () => {
  // migrations-you/0009_course_file_summaries.sql (plan #2401.4): Dash's
  // summary and key points for one course file, one row per file.
  let fileA = '';

  beforeAll(async () => {
    const [t] = await admin<{ id: string }[]>`
      insert into transcripts (user_id, school, file_name, storage_path, mime_type, size_bytes)
      values (${userA}, 'State University', 'summary-record.pdf', ${`${userA}/t-summary-record.pdf`}, 'application/pdf', 1)
      returning id`;
    const [c] = await admin<{ id: string }[]>`
      insert into courses (user_id, transcript_id, school, title, position)
      values (${userA}, ${t.id}, 'State University', 'Microeconomics', 0)
      returning id`;
    const [f] = await admin<{ id: string }[]>`
      insert into course_files (user_id, course_id, kind, title, file_name, storage_path, mime_type, size_bytes)
      values (${userA}, ${c.id}, 'slides', 'Week 1', 'week-1.pdf', ${`${userA}/${c.id}/week-1.pdf`}, 'application/pdf', 1)
      returning id`;
    fileA = f.id;
  });

  const write = (user: string, owner: string, points: string[] = ['Scarcity forces choice.']) =>
    asUser(
      user,
      (tx) => tx`
        insert into course_file_summaries (file_id, user_id, summary, points, model)
        values (${fileA}, ${owner}, 'What the week covers.', ${points}, 'claude-haiku')
        on conflict (file_id) do update set summary = excluded.summary, points = excluded.points
        returning file_id`,
    );

  it('keeps one summary per file, to its owner only, replaced by the next', async () => {
    await write(userA, userA);
    await write(userA, userA, ['Opportunity cost is the next best thing given up.']);
    const own = await asUser(userA, (tx) => tx`select points from course_file_summaries`);
    expect(own).toEqual([{ points: ['Opportunity cost is the next best thing given up.'] }]);
    expect(await asUser(userB, (tx) => tx`select file_id from course_file_summaries`)).toHaveLength(0);
  });

  it("refuses a summary of another account's file", async () => {
    await expect(write(userB, userB)).rejects.toThrow();
    await expect(write(userB, userA)).rejects.toThrow();
  });

  it('refuses no points, more than five, and an empty summary', async () => {
    await expect(write(userA, userA, [])).rejects.toThrow();
    await expect(write(userA, userA, ['1', '2', '3', '4', '5', '6'])).rejects.toThrow();
    await expect(
      asUser(userA, (tx) => tx`update course_file_summaries set summary = '  ' where file_id = ${fileA}`),
    ).rejects.toThrow();
  });

  it('goes with its file', async () => {
    await asUser(userA, (tx) => tx`delete from course_files where id = ${fileA}`);
    expect(await admin`select file_id from course_file_summaries where file_id = ${fileA}`).toHaveLength(0);
  });
});

describe('course weeks', () => {
  // migrations-you/0010_course_weeks.sql (plan #2401.6): a course's weeks,
  // read from its syllabus, one row per week.
  let courseA = '';

  beforeAll(async () => {
    const [t] = await admin<{ id: string }[]>`
      insert into transcripts (user_id, school, file_name, storage_path, mime_type, size_bytes)
      values (${userA}, 'State University', 'weeks-record.pdf', ${`${userA}/t-weeks-record.pdf`}, 'application/pdf', 1)
      returning id`;
    const [c] = await admin<{ id: string }[]>`
      insert into courses (user_id, transcript_id, school, title, position)
      values (${userA}, ${t.id}, 'State University', 'Macroeconomics', 0)
      returning id`;
    courseA = c.id;
  });

  const write = (user: string, owner: string, week: number, title: string | null = 'Scarcity') =>
    asUser(
      user,
      (tx) => tx`
        insert into course_weeks (user_id, course_id, week, title)
        values (${owner}, ${courseA}, ${week}, ${title})
        on conflict (course_id, week) do update set title = excluded.title
        returning id`,
    );

  it('keeps one row per week of a course, to its owner only', async () => {
    await write(userA, userA, 1);
    await write(userA, userA, 1, 'Supply and demand');
    await write(userA, userA, 2, null);
    const own = await asUser(userA, (tx) => tx`select week, title from course_weeks order by week`);
    expect(own).toEqual([
      { week: 1, title: 'Supply and demand' },
      { week: 2, title: null },
    ]);
    expect(await asUser(userB, (tx) => tx`select id from course_weeks`)).toHaveLength(0);
  });

  it("refuses a week on another account's course", async () => {
    await expect(write(userB, userB, 3)).rejects.toThrow();
    await expect(write(userB, userA, 3)).rejects.toThrow();
  });

  it('refuses a week past 60 and a blank title', async () => {
    await expect(write(userA, userA, 61)).rejects.toThrow();
    await expect(write(userA, userA, 4, '  ')).rejects.toThrow();
  });

  it('goes with its course', async () => {
    await asUser(userA, (tx) => tx`delete from courses where id = ${courseA}`);
    expect(await admin`select id from course_weeks where course_id = ${courseA}`).toHaveLength(0);
  });
});

describe('course overviews', () => {
  // migrations-you/0011_course_overviews.sql (plan #2401.7): what a course
  // was about, pulled together from its file summaries, one row per course.
  let courseA = '';
  const files = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'];
  const recurring = JSON.stringify([{ idea: 'Correlation is not cause.', file_ids: files }]);

  beforeAll(async () => {
    const [t] = await admin<{ id: string }[]>`
      insert into transcripts (user_id, school, file_name, storage_path, mime_type, size_bytes)
      values (${userA}, 'State University', 'overview-record.pdf', ${`${userA}/t-overview-record.pdf`}, 'application/pdf', 1)
      returning id`;
    const [c] = await admin<{ id: string }[]>`
      insert into courses (user_id, transcript_id, school, title, position)
      values (${userA}, ${t.id}, 'State University', 'Econometrics', 0)
      returning id`;
    courseA = c.id;
  });

  const write = (user: string, owner: string, fileIds: string[] = files, about = 'How to measure a cause.') =>
    asUser(
      user,
      (tx) => tx`
        insert into course_overviews (course_id, user_id, about, recurring, file_ids, model)
        values (${courseA}, ${owner}, ${about}, ${recurring}::text::jsonb, ${fileIds}::uuid[], 'claude-haiku')
        on conflict (course_id) do update set about = excluded.about
        returning course_id`,
    );

  it('keeps one overview per course, to its owner only, replaced by the next', async () => {
    await write(userA, userA);
    await write(userA, userA, files, 'Regression and its limits.');
    expect(await asUser(userA, (tx) => tx`select about from course_overviews`)).toEqual([
      { about: 'Regression and its limits.' },
    ]);
    expect(await asUser(userB, (tx) => tx`select course_id from course_overviews`)).toHaveLength(0);
  });

  it("refuses an overview of another account's course", async () => {
    await expect(write(userB, userB)).rejects.toThrow();
    await expect(write(userB, userA)).rejects.toThrow();
  });

  it('refuses one read from fewer than two files, and an empty about', async () => {
    await expect(write(userA, userA, [files[0]])).rejects.toThrow();
    await expect(
      asUser(userA, (tx) => tx`update course_overviews set about = '  ' where course_id = ${courseA}`),
    ).rejects.toThrow();
  });

  it('goes with its course', async () => {
    await asUser(userA, (tx) => tx`delete from courses where id = ${courseA}`);
    expect(await admin`select course_id from course_overviews where course_id = ${courseA}`).toHaveLength(0);
  });
});

describe('insights', () => {
  // migrations-you/0010_insights.sql (plan #2413.1): what Dash wrote about
  // the person, the evidence for it, their mark on it and the runs.
  const layers = admin.json([
    { depth: 'saw', text: 'You have lived in four cities.' },
    { depth: 'deeper', text: 'Each move followed a job going flat.' },
  ]);
  const receipts = admin.json([{ source: 'you.places', row_id: 'p1', quote: '2021', link: '/you/places/p1' }]);
  let runA = '';
  let insightA = '';

  it('keeps a run, its insight and the verdict on it, to their owner only', async () => {
    const [run] = await asUser(
      userA,
      (tx) => tx`insert into insight_runs (user_id) values (${userA}) returning id, status`,
    );
    runA = run.id;
    expect(run.status).toBe('queued');
    const [insight] = await asUser(
      userA,
      (tx) => tx`insert into insights (user_id, run_id, kind, claim, layers, receipts, confidence)
                 values (${userA}, ${runA}, 'pattern', 'You move when a job stops teaching you.',
                         ${layers}, ${receipts}, 'medium')
                 returning id, status`,
    );
    insightA = insight.id;
    expect(insight.status).toBe('shown');
    await asUser(
      userA,
      (tx) => tx`insert into insight_verdicts (user_id, insight_id, verdict, note)
                 values (${userA}, ${insightA}, 'not_quite', 'Close')`,
    );
    const own = await asUser(
      userA,
      (tx) => tx`select i.claim, jsonb_array_length(i.layers) as n, v.verdict
                 from insights i join insight_verdicts v on v.insight_id = i.id`,
    );
    expect(own).toEqual([{ claim: 'You move when a job stops teaching you.', n: 2, verdict: 'not_quite' }]);
    expect(await asUser(userB, (tx) => tx`select id from insights`)).toHaveLength(0);
    expect(await asUser(userB, (tx) => tx`select id from insight_verdicts`)).toHaveLength(0);
    expect(await asUser(userB, (tx) => tx`select id from insight_runs`)).toHaveLength(0);
  });

  it("does not let a user write, mark or change another account's insight", async () => {
    await expect(
      asUser(
        userB,
        (tx) => tx`insert into insights (user_id, kind, claim, confidence)
                   values (${userA}, 'pattern', 'Planted', 'high')`,
      ),
    ).rejects.toThrow();
    // Their own row, pointing at someone else's insight or run.
    await expect(
      asUser(
        userB,
        (tx) => tx`insert into insight_verdicts (user_id, insight_id, verdict) values (${userB}, ${insightA}, 'wrong')`,
      ),
    ).rejects.toThrow();
    await expect(
      asUser(
        userB,
        (tx) => tx`insert into insights (user_id, run_id, kind, claim, confidence)
                   values (${userB}, ${runA}, 'pattern', 'Borrowed run', 'high')`,
      ),
    ).rejects.toThrow();
    await asUser(userB, (tx) => tx`update insights set claim = 'Changed'`);
    await asUser(userB, (tx) => tx`delete from insight_verdicts`);
    const left = await admin`select i.claim, v.verdict from insights i join insight_verdicts v on v.insight_id = i.id
                             where i.user_id = ${userA}`;
    expect(left).toEqual([{ claim: 'You move when a job stops teaching you.', verdict: 'not_quite' }]);
  });

  it('keeps one verdict per insight and one open run per person', async () => {
    await expect(
      admin`insert into insight_verdicts (user_id, insight_id, verdict) values (${userA}, ${insightA}, 'right')`,
    ).rejects.toThrow();
    await expect(admin`insert into insight_runs (user_id) values (${userA})`).rejects.toThrow();
    await admin`update insight_runs set status = 'ready', finished_at = now() where id = ${runA}`;
    await admin`insert into insight_runs (user_id) values (${userA})`;
  });

  it('refuses an insight of the wrong shape', async () => {
    const bad = [
      () => admin`insert into insights (user_id, kind, claim, confidence) values (${userA}, 'pattern', 'x', 'certain')`,
      () => admin`insert into insights (user_id, kind, claim, confidence) values (${userA}, 'Pattern!', 'x', 'high')`,
      () => admin`insert into insights (user_id, kind, claim, confidence) values (${userA}, 'pattern', ' ', 'high')`,
      () => admin`insert into insights (user_id, kind, claim, confidence, layers)
                  values (${userA}, 'pattern', 'x', 'high', '{}'::jsonb)`,
      () => admin`insert into insights (user_id, kind, claim, confidence, status)
                  values (${userA}, 'pattern', 'x', 'high', 'hidden')`,
      () => admin`insert into insights (user_id, kind, claim, confidence, superseded_by)
                  values (${userA}, 'pattern', 'x', 'high', ${insightA})`,
      () => admin`insert into insight_verdicts (user_id, insight_id, verdict) values (${userA}, ${insightA}, 'maybe')`,
    ];
    for (const statement of bad) await expect(statement()).rejects.toThrow();
  });

  it('points a superseded insight at its replacement, and takes the verdict with the insight', async () => {
    const [next] = await admin<{ id: string }[]>`
      insert into insights (user_id, kind, claim, confidence)
      values (${userA}, 'pattern', 'You move when you stop learning.', 'high') returning id`;
    await admin`update insights set status = 'superseded', superseded_by = ${next.id} where id = ${insightA}`;
    await admin`delete from insight_runs where id = ${runA}`;
    const [kept] = await admin`select run_id, superseded_by from insights where id = ${insightA}`;
    expect(kept).toEqual({ run_id: null, superseded_by: next.id });
    await admin`delete from insights where id = ${insightA}`;
    expect(await admin`select id from insight_verdicts where insight_id = ${insightA}`).toHaveLength(0);
  });
});

describe('insight digest and saving one call', () => {
  // migrations-you/0014_insight_digest.sql (plan #2413.9): the account Dash
  // keeps for its next call, and the save that writes a call's cards together.
  const card = (claim: string, extra: Record<string, unknown> = {}) => ({
    kind: 'pattern',
    claim,
    layers: [
      { depth: 'saw', text: 'a' },
      { depth: 'deeper', text: 'b' },
      { depth: 'further', text: 'c' },
    ],
    receipts: [
      { source: 'Me/Notes to Self.md', row_id: null, quote: 'q', link: '/vault/n/Me/Notes%20to%20Self.md' },
      { source: 'you.insight_signals', row_id: null, quote: '3', link: null },
    ],
    confidence: 'medium',
    live_ref: null,
    ...extra,
  });

  it('saves the cards, their tripwires, the replacement and the digest, and marks the run ready', async () => {
    const [old] = await admin<{ id: string }[]>`
      insert into insights (user_id, kind, claim, confidence) values (${userA}, 'pattern', 'Old card', 'hunch') returning id`;
    // The insights tests above leave a run open, and one is allowed at a time.
    await admin`update insight_runs set status = 'failed' where user_id = ${userA} and status in ('queued', 'running')`;
    const [run] = await admin<{ id: string }[]>`insert into insight_runs (user_id, status) values (${userA}, 'running') returning id`;
    const insights = [
      card('First', { tripwire: { kind: 'want_recurring', params: { words: ['write'], min_mentions: 2 } } }),
      card('Second', { supersedes: old.id }),
    ];
    const [{ ids }] = await admin<{ ids: string[] }[]>`
      select you.save_insight_run(${userA}, ${run.id}, ${admin.json(insights)}, 'Digest text', 'Summary.') as ids`;
    expect(ids).toHaveLength(2);
    const [saved] = await admin`select status, summary from insight_runs where id = ${run.id}`;
    expect(saved).toEqual({ status: 'ready', summary: 'Summary.' });
    expect(await admin`select kind from insight_tripwires where insight_id = ${ids[0]}`).toEqual([{ kind: 'want_recurring' }]);
    const [replaced] = await admin`select status, superseded_by from insights where id = ${old.id}`;
    expect(replaced).toEqual({ status: 'superseded', superseded_by: ids[1] });
    const [digest] = await admin`select body, run_id from insight_digest where user_id = ${userA}`;
    expect(digest).toEqual({ body: 'Digest text', run_id: run.id });

    // A run already finished is refused, and nothing of it lands.
    await expect(
      admin`select you.save_insight_run(${userA}, ${run.id}, ${admin.json([card('Third')])}, 'New', 'S')`,
    ).rejects.toThrow(/already ready/);
    expect(await admin`select id from insights where claim = 'Third'`).toHaveLength(0);
  });

  it('keeps the digest to its owner, and lets only the service role write it', async () => {
    expect(await asUser(userA, (tx) => tx`select body from insight_digest`)).toHaveLength(1);
    expect(await asUser(userB, (tx) => tx`select body from insight_digest`)).toHaveLength(0);
    await expect(
      asUser(userB, (tx) => tx`insert into insight_digest (user_id, body) values (${userB}, 'x')`),
    ).rejects.toThrow();
    await expect(
      asUser(userA, (tx) => tx`select you.save_insight_run(${userA}, gen_random_uuid(), '[]'::jsonb, 'x', 'y')`),
    ).rejects.toThrow();
  });
});

describe('profile entries', () => {
  // migrations-you/0015 (plan #2432.7): what the LinkedIn import wrote about
  // schools, certifications, honors and skills.
  it('are read and written by their owner only', async () => {
    await asUser(
      userA,
      (tx) => tx`insert into profile_entries (user_id, kind, name) values (${userA}, 'skill', 'Accounting')`,
    );
    const seenByB = await asUser(userB, (tx) => tx`select id from profile_entries`);
    expect(seenByB).toEqual([]);
    const seenByA = await asUser(userA, (tx) => tx`select name from profile_entries`);
    expect(seenByA).toEqual([{ name: 'Accounting' }]);
    await expect(
      asUser(
        userB,
        (tx) => tx`insert into profile_entries (user_id, kind, name) values (${userA}, 'skill', 'Forged')`,
      ),
    ).rejects.toThrow();
  });
});
