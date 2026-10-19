/**
 * The topic tables of LEARN-LEVELS-SPEC (plan #2138.1): each account sees
 * only its own rows and the shared map, a link cannot point across accounts,
 * and the database refuses a link that would close a cycle once the in-topic
 * level chain is counted. Shared rows (plan #2138.10, learn 0145) are read by
 * every account and written by none of them.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asUser, closeDb, createUser, truncateAll } from './helpers/db-learn';

let userA = '';
let userB = '';
/** Cells of userA's two topics, by level. */
const capm: Record<number, string> = {};
const ret: Record<number, string> = {};
let cellB = '';

async function seedTopic(userId: string | null, name: string): Promise<string> {
  const [row] = await admin<{ id: string }[]>`
    insert into topics (user_id, name, scope) values (${userId}, ${name}, ${`What ${name} covers.`})
    returning id`;
  return row.id;
}

async function seedCell(userId: string | null, topicId: string, level: number): Promise<string> {
  const [row] = await admin<{ id: string }[]>`
    insert into topic_cells (user_id, topic_id, level, descriptor)
    values (${userId}, ${topicId}, ${level}, ${['Can say one thing.', 'Can say another.']})
    returning id`;
  return row.id;
}

async function link(userId: string | null, requiring: string, required: string): Promise<void> {
  await admin`
    insert into cell_links (user_id, requiring_cell_id, required_cell_id)
    values (${userId}, ${requiring}, ${required})`;
}

/** Shared topics hang off no account, so removing the accounts leaves them. */
async function clearAll(): Promise<void> {
  await truncateAll();
  await admin`delete from topics where user_id is null`;
}

beforeAll(async () => {
  await clearAll();
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
  await clearAll();
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
    await expect(link(userA, capm[5], cellB)).rejects.toThrow(/another account/);
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

describe('the shared territory (plan #2138.10)', () => {
  let shared = '';
  const wacc: Record<number, string> = {};

  beforeAll(async () => {
    shared = await seedTopic(null, 'WACC');
    for (const level of [1, 2]) wacc[level] = await seedCell(null, shared, level);
  });

  it('lets every signed-in account read a topic with no owner, with its cells', async () => {
    for (const user of [userA, userB]) {
      const seen = await asUser(user, async (tx) => ({
        topic: (await tx`select name from topics where id = ${shared}`).map((r) => r.name),
        cells: (await tx`select id from topic_cells where topic_id = ${shared}`).length,
      }));
      expect(seen).toEqual({ topic: ['WACC'], cells: 2 });
    }
  });

  it('lets no account write a shared row', async () => {
    await expect(
      asUser(userA, (tx) => tx`insert into topics (user_id, name, scope) values (null, 'Debt', 'What debt covers.')`),
    ).rejects.toThrow(/row-level security/);
    const changed = await asUser(userA, async (tx) => ({
      updated: (await tx`update topics set name = 'Hijacked' where id = ${shared} returning id`).length,
      cells: (await tx`update topic_cells set descriptor = ${['One.', 'Two.']} where topic_id = ${shared} returning id`)
        .length,
      deleted: (await tx`delete from topics where id = ${shared} returning id`).length,
    }));
    expect(changed).toEqual({ updated: 0, cells: 0, deleted: 0 });
  });

  it('lets an account link its own cell to a shared one and keep evidence on a shared cell', async () => {
    await asUser(userA, (tx) => tx`
      insert into cell_links (user_id, requiring_cell_id, required_cell_id)
      values (${userA}, ${capm[5]}, ${wacc[2]})`);
    await asUser(userA, (tx) => tx`
      insert into cell_evidence (user_id, cell_id, verdict) values (${userA}, ${wacc[1]}, 'declared')`);
    const seenByB = await asUser(userB, async (tx) => ({
      links: (await tx`select id from cell_links where required_cell_id = ${wacc[2]}`).length,
      evidence: (await tx`select id from cell_evidence where cell_id = ${wacc[1]}`).length,
    }));
    expect(seenByB).toEqual({ links: 0, evidence: 0 });
  });

  it('refuses a shared row that points at a personal one, and a personal cell on a shared topic', async () => {
    await expect(link(null, wacc[2], capm[1])).rejects.toThrow(/another account/);
    await expect(seedCell(userA, shared, 3)).rejects.toThrow(/another account/);
    await expect(admin`update topics set user_id = ${userA} where id = ${shared}`).rejects.toThrow(/keeps the owner/);
  });

  it('versions a cell when its checks are reworded, and stamps evidence with the version', async () => {
    const [before] = await admin<{ id: string; cell_version: number }[]>`
      insert into cell_evidence (user_id, cell_id, verdict) values (${userB}, ${wacc[2]}, 'declared')
      returning id, cell_version`;
    expect(before.cell_version).toBe(1);
    await admin`update topic_cells set descriptor = ${['Can say it again.', 'Can say more.']} where id = ${wacc[2]}`;
    await admin`update topic_cells set source = 'A textbook' where id = ${wacc[2]}`;
    const [cell] = await admin<{ version: number }[]>`select version from topic_cells where id = ${wacc[2]}`;
    expect(cell.version).toBe(2);
    const [after] = await admin<{ cell_version: number }[]>`
      insert into cell_evidence (user_id, cell_id, verdict) values (${userB}, ${wacc[2]}, 'declared')
      returning cell_version`;
    expect(after.cell_version).toBe(2);
  });

  it('takes a source, a canonicality and the frame topic a topic refines', async () => {
    await expect(admin`update topics set canonicality = 'folk' where id = ${shared}`).rejects.toThrow(
      /topics_canonicality_ck/,
    );
    await admin`update topics set source = 'CFA level I outcomes', canonicality = 'canonical' where id = ${shared}`;
    const [row] = await admin<{ source: string; canonicality: string; refines_article_id: string | null }[]>`
      select source, canonicality, refines_article_id from topics where id = ${shared}`;
    expect(row).toEqual({ source: 'CFA level I outcomes', canonicality: 'canonical', refines_article_id: null });
  });
});

describe('approving a draft (plan #2138.11)', () => {
  it('refuses a draft with an uncited row until it is cited or marked personal', async () => {
    const topic = await seedTopic(userA, 'Free cash flow');
    const one = await seedCell(userA, topic, 1);
    await admin`update topics set ceiling = 1, source = 'A syllabus', canonicality = 'canonical' where id = ${topic}`;
    await link(userA, one, ret[1]);
    await admin`update cell_links set source = 'A syllabus', canonicality = 'canonical' where requiring_cell_id = ${one}`;

    const approve = () =>
      asUser(userA, (tx) => tx`update topics set status = 'approved', approved_at = now() where id = ${topic}`);
    await expect(approve()).rejects.toThrow(/uncited/);

    // The person marks the one uncited level personal; the draft then goes through.
    const marked = await asUser(
      userA,
      (tx) => tx`update topic_cells set canonicality = 'personal' where id = ${one} and source is null returning id`,
    );
    expect(marked).toHaveLength(1);
    await approve();
    const [row] = await admin<{ status: string }[]>`select status from topics where id = ${topic}`;
    expect(row.status).toBe('approved');
  });

  it('approves a draft whose uncited rows Dash marked personal on the service role (plan #2356.6)', async () => {
    const topic = await seedTopic(userA, 'Unlevered beta');
    const one = await seedCell(userA, topic, 1);
    await admin`update topics set ceiling = 1 where id = ${topic}`;

    await admin`update topics set canonicality = 'personal' where id = ${topic} and source is null`;
    await admin`update topic_cells set canonicality = 'personal' where id = ${one} and source is null`;
    await admin`update topics set status = 'approved', approved_at = now() where id = ${topic}`;
    const [row] = await admin<{ status: string }[]>`select status from topics where id = ${topic}`;
    expect(row.status).toBe('approved');
  });

  it('keeps what the drafting checks were as an object', async () => {
    const topic = await seedTopic(userA, 'Terminal value');
    await expect(admin`update topics set drafting = '[]'::jsonb where id = ${topic}`).rejects.toThrow(
      /topics_drafting_ck/,
    );
    await admin`update topics set drafting = '{"sources": [], "performances": []}'::jsonb where id = ${topic}`;
  });
});
