/**
 * The same idea in two subjects (plan #2147.2): learn.cross_subject_idea_pairs,
 * learn.keep_both_ideas and learn.merge_ideas.
 *
 * A close pair across two subjects is listed once and a close pair inside one
 * subject is not. Keeping both carries a tested result across as inferred and
 * stops the listing. Merging leaves one idea with both subjects' answers and
 * a copy of what went. Neither touches another account's ideas.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asUser, closeDb, createUser, truncateAll } from './helpers/db-learn';

const MODEL = 'voyage-4-lite';

/** A unit vector 1,024 wide pointing mostly along `axis`, tilted toward `tilt` by `t`. */
function vector(axis: number, tilt = axis, t = 0): string {
  const v = new Array<number>(1024).fill(0);
  v[axis] = Math.cos(t);
  v[tilt] = (v[tilt] ?? 0) + Math.sin(t);
  return `[${v.join(',')}]`;
}

let user = '';
let other = '';
const ids: Record<string, string> = {};
const subjects: Record<string, string> = {};

async function subject(userId: string, name: string): Promise<string> {
  const [row] = await admin<{ id: string }[]>`
    insert into subjects (user_id, name) values (${userId}, ${name}) returning id`;
  return row.id;
}

async function concept(userId: string, subjectId: string, name: string, embedding: string): Promise<string> {
  const [row] = await admin<{ id: string }[]>`
    insert into concepts (user_id, subject_id, name, claim, basis, embedding, embedding_model)
    values (${userId}, ${subjectId}, ${name}, ${name + ' holds.'}, 'Test me on this.',
            ${embedding}::extensions.vector, ${MODEL})
    returning id`;
  return row.id;
}

type Pair = { a_id: string; b_id: string; similarity: number };

async function pairsFor(userId: string): Promise<Pair[]> {
  return asUser(userId, (tx) => tx<Pair[]>`select * from cross_subject_idea_pairs(0.86)`);
}

function samePair(pair: Pair, x: string, y: string): boolean {
  return (pair.a_id === x && pair.b_id === y) || (pair.a_id === y && pair.b_id === x);
}

beforeAll(async () => {
  await truncateAll();
  user = await createUser('idea-pairs@example.com');
  other = await createUser('idea-pairs-other@example.com');

  subjects.saas = await subject(user, 'SaaS metrics');
  subjects.finance = await subject(user, 'Startup finance');

  // MRR twice, once tested; CAC twice, never answered; two close ideas inside one subject.
  ids.mrr = await concept(user, subjects.saas, 'MRR is a run-rate', vector(0));
  ids.mrrFinance = await concept(user, subjects.finance, 'mrr_definition', vector(0, 1, 0.2));
  ids.cac = await concept(user, subjects.saas, 'CAC is fully loaded', vector(2));
  ids.cacFinance = await concept(user, subjects.finance, 'cac_fully_loaded', vector(2, 3, 0.2));
  ids.churn = await concept(user, subjects.saas, 'Churn compounds', vector(4));
  ids.churnToo = await concept(user, subjects.saas, 'Churn compounds monthly', vector(4, 5, 0.2));
  ids.ltv = await concept(user, subjects.finance, 'LTV rests on CAC', vector(6));

  await admin`
    insert into concept_state (concept_id, user_id, state, established, tested_at)
    values (${ids.mrr}, ${user}, 'known', 'tested', now() - interval '1 day')`;
  await admin`
    insert into probes
      (user_id, concept_id, question, rung, expected, response, response_correct, grade_reason, answered_at)
    values (${user}, ${ids.cacFinance}, 'What goes into CAC?', 'apply', 'Every cost of winning customers.',
            'Salaries and tools too.', true, 'Names the costs beyond ads.', now())`;
  await admin`
    insert into concept_edges (user_id, subject_id, prerequisite_id, dependent_id, basis)
    values (${user}, ${subjects.finance}, ${ids.cacFinance}, ${ids.ltv}, 'LTV over CAC needs CAC.')`;

  const otherSubject = await subject(other, 'Someone else');
  ids.foreign = await concept(other, otherSubject, 'Not yours', vector(2, 3, 0.1));
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

describe('learn.cross_subject_idea_pairs', () => {
  it('lists each close pair across subjects once, and none inside one subject', async () => {
    const pairs = await pairsFor(user);
    expect(pairs).toHaveLength(2);
    expect(pairs.some((p) => samePair(p, ids.mrr, ids.mrrFinance))).toBe(true);
    expect(pairs.some((p) => samePair(p, ids.cac, ids.cacFinance))).toBe(true);
    for (const p of pairs) expect(p.a_id < p.b_id).toBe(true);
  });
});

describe('learn.keep_both_ideas', () => {
  it('carries a tested result across as inferred and stops listing the pair', async () => {
    const [row] = await asUser(user, (tx) => tx<{ carried: string | null }[]>`
      select keep_both_ideas(${ids.mrr}, ${ids.mrrFinance}, 0.98) as carried`);
    expect(row.carried).toBe(ids.mrrFinance);

    const [state] = await admin<{ state: string; established: string; tested_at: Date | null }[]>`
      select state, established, tested_at from concept_state where concept_id = ${ids.mrrFinance}`;
    expect(state).toEqual({ state: 'known', established: 'inferred', tested_at: null });

    const [tested] = await admin<{ established: string }[]>`
      select established from concept_state where concept_id = ${ids.mrr}`;
    expect(tested.established).toBe('tested');

    const pairs = await pairsFor(user);
    expect(pairs.some((p) => samePair(p, ids.mrr, ids.mrrFinance))).toBe(false);
  });

  it('refuses an idea that is not the caller’s', async () => {
    await expect(
      asUser(user, (tx) => tx`select keep_both_ideas(${ids.cac}, ${ids.foreign}, 0.9)`),
    ).rejects.toThrow(/not found/);
  });
});

describe('learn.merge_ideas', () => {
  it('refuses an idea that is not the caller’s', async () => {
    await expect(
      asUser(other, (tx) => tx`select merge_ideas(${ids.cac}, ${ids.cacFinance}, 0.98)`),
    ).rejects.toThrow(/not found/);
    const [still] = await admin<{ n: number }[]>`select count(*)::int as n from concepts where id = ${ids.cacFinance}`;
    expect(still.n).toBe(1);
  });

  it('leaves one idea in both subjects with both ideas’ answers', async () => {
    await asUser(user, (tx) => tx`select merge_ideas(${ids.cac}, ${ids.cacFinance}, 0.98)`);

    const [gone] = await admin<{ n: number }[]>`select count(*)::int as n from concepts where id = ${ids.cacFinance}`;
    expect(gone.n).toBe(0);

    const probes = await admin<{ concept_id: string }[]>`select concept_id from probes where user_id = ${user}`;
    expect(probes.map((p) => p.concept_id)).toEqual([ids.cac]);

    const listed = await admin<{ subject_id: string }[]>`
      select subject_id from concept_subjects where concept_id = ${ids.cac}`;
    expect(listed.map((row) => row.subject_id)).toEqual([subjects.finance]);

    const [review] = await admin<{ decision: string; kept_id: string; retired: { concept: { name: string }; edges: unknown[] } }[]>`
      select decision, kept_id, retired from idea_pair_reviews where kept_id = ${ids.cac}`;
    expect(review.decision).toBe('merged');
    expect(review.retired.concept.name).toBe('cac_fully_loaded');
    // The link into LTV could not follow it into another subject, so it is kept in the copy.
    expect(review.retired.edges).toHaveLength(1);

    expect(await pairsFor(user)).toEqual([]);
  });
});
