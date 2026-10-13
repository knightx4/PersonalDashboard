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
    expect(rows.map((r) => r.tablename)).toEqual(['personality_results']);
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
