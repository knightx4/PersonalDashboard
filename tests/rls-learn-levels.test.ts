/**
 * The topic tables of LEARN-LEVELS-SPEC (plan #2138.1): each account sees
 * only its own rows, a link cannot point across accounts, and the database
 * refuses a link that would close a cycle once the in-topic level chain is
 * counted.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asUser, closeDb, createUser, truncateAll } from './helpers/db-learn';

let userA = '';
let userB = '';
/** Cells of userA's two topics, by level. */
const capm: Record<number, string> = {};
const ret: Record<number, string> = {};
let cellB = '';

async function seedTopic(userId: string, name: string): Promise<string> {
  const [row] = await admin<{ id: string }[]>`
    insert into topics (user_id, name, scope) values (${userId}, ${name}, ${`What ${name} covers.`})
    returning id`;
  return row.id;
}

async function seedCell(userId: string, topicId: string, level: number): Promise<string> {
  const [row] = await admin<{ id: string }[]>`
    insert into topic_cells (user_id, topic_id, level, descriptor)
    values (${userId}, ${topicId}, ${level}, ${['Can say one thing.', 'Can say another.']})
    returning id`;
  return row.id;
}

async function link(userId: string, requiring: string, required: string): Promise<void> {
  await admin`
    insert into cell_links (user_id, requiring_cell_id, required_cell_id)
    values (${userId}, ${requiring}, ${required})`;
}

beforeAll(async () => {
  await truncateAll();
  userA = await createUser('levels-a@example.com');
  userB = await createUser('levels-b@example.com');
  const capmTopic = await seedTopic(userA, 'CAPM');
  const returnTopic = await seedTopic(userA, 'Return');
  for (const level of [1, 2, 3, 5]) {
    capm[level] = await seedCell(userA, capmTopic, level);
    ret[level] = await seedCell(userA, returnTopic, level);
  }
  // CAPM 3 requires Return 2.
  await link(userA, capm[3], ret[2]);
  await admin`insert into cell_evidence (user_id, cell_id, verdict, quote)
              values (${userA}, ${capm[3]}, 'met', 'the premium over the risk-free rate')`;
  const [lens] = await admin<{ id: string }[]>`
    insert into lenses (user_id, name, origin) values (${userA}, 'Corporate finance', 'goal') returning id`;
  await admin`insert into lens_targets (user_id, lens_id, topic_id, target_level)
              values (${userA}, ${lens.id}, ${capmTopic}, 6)`;

  const otherTopic = await seedTopic(userB, 'Beta');
  cellB = await seedCell(userB, otherTopic, 1);
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

describe('the topic tables', () => {
  it('shows each account only its own rows', async () => {
    const seen = await asUser(userB, async (tx) => ({
      topics: (await tx`select name from topics`).map((r) => r.name),
      cells: (await tx`select id from topic_cells`).length,
      links: (await tx`select id from cell_links`).length,
      evidence: (await tx`select id from cell_evidence`).length,
      lenses: (await tx`select id from lenses`).length,
      targets: (await tx`select id from lens_targets`).length,
    }));
    expect(seen).toEqual({ topics: ['Beta'], cells: 1, links: 0, evidence: 0, lenses: 0, targets: 0 });
  });

  it('refuses a link to another account’s cell', async () => {
    await expect(link(userA, capm[5], cellB)).rejects.toThrow(/foreign key/);
  });

  it('refuses a link within one topic', async () => {
    await expect(link(userA, capm[5], capm[1])).rejects.toThrow(/one topic/);
  });

  it('refuses a direct cycle', async () => {
    await expect(link(userA, ret[2], capm[3])).rejects.toThrow(/cycle/);
  });

  it('refuses a cycle that runs through the level chain', async () => {
    // Return 5 needs Return 2, which needs nothing on CAPM; Return 5 requiring
    // CAPM 1 is fine. Return 1 requiring CAPM 5 closes CAPM 5 > CAPM 3 >
    // Return 2 > Return 1 > CAPM 5.
    await link(userA, ret[5], capm[1]);
    await expect(link(userA, ret[1], capm[5])).rejects.toThrow(/cycle/);
  });

  it('keeps a cell on its topic and level', async () => {
    await expect(admin`update topic_cells set level = 4 where id = ${capm[5]}`).rejects.toThrow(/keeps its topic/);
  });

  it('refuses a quote on anything but met', async () => {
    await expect(
      admin`insert into cell_evidence (user_id, cell_id, verdict, quote)
            values (${userA}, ${ret[2]}, 'not_met', 'a quote')`,
    ).rejects.toThrow(/cell_evidence_quote_ck/);
  });
});

describe('questions about a cell (plan #2138.5)', () => {
  async function ask(userId: string, cellId: string): Promise<string> {
    const [row] = await admin<{ id: string }[]>`
      insert into cell_questions (user_id, cell_id, format, question)
      values (${userId}, ${cellId}, 'explain', 'In your own words, what is CAPM?')
      returning id`;
    return row.id;
  }

  it('shows each account only its own questions', async () => {
    await ask(userA, capm[2]);
    const seen = await asUser(userB, async (tx) => (await tx`select id from cell_questions`).length);
    expect(seen).toBe(0);
  });

  it('ties evidence to its question, and refuses a declaration that names one', async () => {
    const question = await ask(userA, capm[1]);
    await admin`insert into cell_evidence (user_id, cell_id, verdict, quote, question_id)
                values (${userA}, ${capm[1]}, 'met', 'a way of pricing risk', ${question})`;
    await expect(
      admin`insert into cell_evidence (user_id, cell_id, verdict, question_id)
            values (${userA}, ${capm[1]}, 'declared', ${question})`,
    ).rejects.toThrow(/cell_evidence_declared_question_ck/);
  });

  it('refuses an answer with no time, and a case with no expected answer', async () => {
    const question = await ask(userA, capm[3]);
    await expect(admin`update cell_questions set response = 'An answer.' where id = ${question}`).rejects.toThrow(
      /cell_questions_answered_ck/,
    );
    await expect(
      admin`insert into cell_questions (user_id, cell_id, format, question)
            values (${userA}, ${capm[5]}, 'case', 'Value this firm.')`,
    ).rejects.toThrow(/cell_questions_case_ck/);
  });
});
