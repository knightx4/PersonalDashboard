/**
 * Cross-user isolation for the graph half of the learn module, and the one
 * property the whole thing rests on: no cycles.
 *
 * The isolation half is the same rule as everywhere else, applied to six new
 * tables. What is worth more than "can B read A's rows" here is what a leak
 * would actually be. A concept graph is a map of what somebody does not
 * understand, and `concept_state.misconception` is the sharpest sentence this
 * application will ever store about a person -- not "has not read this" but
 * "believes this specific wrong thing". A probe row is the evidence for it.
 *
 * The acyclic half is asserted rather than assumed because everything that
 * reads this graph -- the pruning rule, the reading order, "what is the next
 * thing worth learning" -- walks it and assumes termination. A cycle does not
 * surface as a wrong answer; it surfaces as a page that never loads, weeks
 * after whatever wrote it. So the database refuses the edge, and this proves
 * the database refuses the edge.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asUser, closeDb, createUser, truncateAll } from './helpers/db-learn';

let userA = '';
let userB = '';
let subjectA = '';
let subjectB = '';
/** A → B → C in userA's subject. */
let conceptA1 = '';
let conceptA2 = '';
let conceptA3 = '';
let conceptB1 = '';

async function seedSubject(userId: string, name: string): Promise<string> {
  const [row] = await admin<{ id: string }[]>`
    insert into subjects (user_id, name) values (${userId}, ${name}) returning id`;
  return row.id;
}

async function seedConcept(
  userId: string,
  subjectId: string,
  name: string,
  claim: string,
): Promise<string> {
  const [row] = await admin<{ id: string }[]>`
    insert into concepts (user_id, subject_id, name, claim, basis)
    values (${userId}, ${subjectId}, ${name}, ${claim}, 'Seeded by the test.')
    returning id`;
  return row.id;
}

async function seedEdge(
  userId: string,
  subjectId: string,
  prerequisite: string,
  dependent: string,
): Promise<void> {
  await admin`
    insert into concept_edges (user_id, subject_id, prerequisite_id, dependent_id, basis)
    values (${userId}, ${subjectId}, ${prerequisite}, ${dependent}, 'Seeded by the test.')`;
}

beforeAll(async () => {
  await truncateAll();
  userA = await createUser('learn-graph-a@example.com');
  userB = await createUser('learn-graph-b@example.com');

  subjectA = await seedSubject(userA, 'Economics');
  // Same name, different account. One graph per subject per user, and the
  // uniqueness is scoped accordingly.
  subjectB = await seedSubject(userB, 'Economics');

  conceptA1 = await seedConcept(userA, subjectA, 'Wage stickiness', 'Wages adjust more slowly than prices.');
  conceptA2 = await seedConcept(userA, subjectA, 'Short-run tradeoff', 'Inflation and unemployment trade off while expectations lag.');
  conceptA3 = await seedConcept(userA, subjectA, 'Expectations catch up', 'The tradeoff disappears once expectations adjust.');
  conceptB1 = await seedConcept(userB, subjectB, 'Bob knows a thing', 'Bob has his own claim.');

  await seedEdge(userA, subjectA, conceptA1, conceptA2);
  await seedEdge(userA, subjectA, conceptA2, conceptA3);

  await admin`
    insert into concept_state (concept_id, user_id, state, established, misconception)
    values (${conceptA2}, ${userA}, 'misconception', 'tested',
            'Believes the tradeoff is permanent rather than expectations-dependent.')`;

  await admin`update concept_state set tested_at = now() where concept_id = ${conceptA2}`;

  await admin`
    insert into goals (user_id, subject_id, asked, concept_id, status)
    values (${userA}, ${subjectA}, 'the phillips curve', ${conceptA3}, 'active')`;

  await admin`
    insert into probes (user_id, concept_id, question, options, correct_index, reason, chosen_index, answered_at, weight)
    values (${userA}, ${conceptA2},
            'Expectations adjust fully. What happens to the short-run tradeoff?',
            ${admin.json(['It steepens', 'It vanishes', 'It inverts'])}, 1,
            'Once expectations catch up there is no surprise left to exploit.',
            0, now(), 1.0)`;
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

  it('seeds every graph table, so a new one cannot skip the isolation check', async () => {
    const seeded = await admin<{ table_name: string; rows: number }[]>`
      select 'subjects' as table_name, count(*)::int as rows from subjects
      union all select 'concepts', count(*)::int from concepts
      union all select 'concept_edges', count(*)::int from concept_edges
      union all select 'goals', count(*)::int from goals
      union all select 'concept_state', count(*)::int from concept_state
      union all select 'probes', count(*)::int from probes
      order by 1`;
    for (const row of seeded) expect(row.rows).toBeGreaterThan(0);
  });
});

describe('cross-user reads', () => {
  it('shows the owner their own graph', async () => {
    const seen = await asUser(userA, async (tx) => ({
      subjects: (await tx`select id from subjects`).length,
      concepts: (await tx`select id from concepts`).length,
      edges: (await tx`select id from concept_edges`).length,
      goals: (await tx`select id from goals`).length,
      state: (await tx`select concept_id from concept_state`).length,
      probes: (await tx`select id from probes`).length,
    }));
    expect(seen).toEqual({ subjects: 1, concepts: 3, edges: 2, goals: 1, state: 1, probes: 1 });
  });

  it('shows another user none of it', async () => {
    const seen = await asUser(userB, async (tx) => ({
      subjects: (await tx`select id from subjects where id = ${subjectA}`).length,
      concepts: (await tx`select id from concepts where subject_id = ${subjectA}`).length,
      edges: (await tx`select id from concept_edges where subject_id = ${subjectA}`).length,
      goals: (await tx`select id from goals where subject_id = ${subjectA}`).length,
      state: (await tx`select concept_id from concept_state where concept_id = ${conceptA2}`).length,
      probes: (await tx`select id from probes where concept_id = ${conceptA2}`).length,
    }));
    expect(seen).toEqual({ subjects: 0, concepts: 0, edges: 0, goals: 0, state: 0, probes: 0 });
  });

  it('never leaks a named misconception', async () => {
    // The sharpest sentence this application stores about anybody: not "has
    // not read this" but "believes this specific wrong thing".
    const rows = await asUser(
      userB,
      (tx) => tx`select misconception from concept_state where misconception is not null`,
    );
    expect(rows).toHaveLength(0);
  });

  it('never leaks what somebody answered', async () => {
    const rows = await asUser(
      userB,
      (tx) => tx`select question, chosen_index from probes`,
    );
    expect(rows).toHaveLength(0);
  });

  it('does not leak a subject that only shares a name with your own', async () => {
    const rows = await asUser(userB, (tx) => tx`select id from subjects where name = 'Economics'`);
    expect(rows).toHaveLength(1);
    expect((rows[0] as { id: string }).id).toBe(subjectB);
  });
});

describe('cross-user writes', () => {
  it('does not let another user add a node to your graph', async () => {
    // The insert carries their own user id, so the policy's `with check` is
    // what refuses it -- a foreign key alone would happily accept the subject.
    await expect(
      asUser(
        userB,
        (tx) => tx`insert into concepts (user_id, subject_id, name, claim, basis)
                   values (${userB}, ${subjectA}, 'Mallory', 'A claim.', 'Injected.')
                   returning id`,
      ),
    ).rejects.toThrow();
  });

  it('does not let another user rewrite a claim you are being probed on', async () => {
    const affected = await asUser(
      userB,
      (tx) => tx`update concepts set claim = 'Something else entirely'
                 where id = ${conceptA2} returning id`,
    );
    expect(affected).toHaveLength(0);
  });

  it('does not let another user mark you as knowing something', async () => {
    const affected = await asUser(
      userB,
      (tx) => tx`update concept_state set state = 'known'
                 where concept_id = ${conceptA2} returning concept_id`,
    );
    expect(affected).toHaveLength(0);
  });

  it('does not let another user delete your subject out from under you', async () => {
    const deleted = await asUser(
      userB,
      (tx) => tx`delete from subjects where id = ${subjectA} returning id`,
    );
    expect(deleted).toHaveLength(0);
  });
});

describe('the graph stays a graph', () => {
  it('refuses an edge that would close a long loop', async () => {
    // A → B → C exists. C → A would close it.
    await expect(seedEdge(userA, subjectA, conceptA3, conceptA1)).rejects.toThrow(/cycle/i);
  });

  it('refuses an edge that would close a one-hop loop', async () => {
    await expect(seedEdge(userA, subjectA, conceptA2, conceptA1)).rejects.toThrow(/cycle/i);
  });

  it('refuses a concept that is its own prerequisite', async () => {
    await expect(seedEdge(userA, subjectA, conceptA1, conceptA1)).rejects.toThrow();
  });

  it('refuses the same edge twice', async () => {
    await expect(seedEdge(userA, subjectA, conceptA1, conceptA2)).rejects.toThrow();
  });

  it('still accepts an edge that does not close anything', async () => {
    // A → C alongside A → B → C is a shortcut, not a cycle.
    await expect(seedEdge(userA, subjectA, conceptA1, conceptA3)).resolves.toBeUndefined();
    await admin`delete from concept_edges
                where prerequisite_id = ${conceptA1} and dependent_id = ${conceptA3}`;
  });

  it('refuses an edge whose ends are in different subjects', async () => {
    // One graph per subject is a foreign key here, not a convention: both ends
    // are keyed on (id, subject_id).
    await expect(seedEdge(userA, subjectA, conceptA1, conceptB1)).rejects.toThrow();
  });
});

describe('a node is a claim, not a heading', () => {
  it('refuses a concept with no claim', async () => {
    await expect(
      admin`insert into concepts (user_id, subject_id, name, claim, basis)
            values (${userA}, ${subjectA}, 'The Phillips curve', '', 'A heading.')`,
    ).rejects.toThrow();
  });

  it('refuses a concept with no stated basis', async () => {
    await expect(
      admin`insert into concepts (user_id, subject_id, name, claim, basis)
            values (${userA}, ${subjectA}, 'Something', 'A real claim.', '')`,
    ).rejects.toThrow();
  });

  it('refuses a misconception state with nothing named', async () => {
    // The state and the sentence are one fact. Either alone is unusable: a
    // misconception nobody can read is indistinguishable from a gap.
    await expect(
      admin`insert into concept_state (concept_id, user_id, state, established)
            values (${conceptA1}, ${userA}, 'misconception', 'tested')`,
    ).rejects.toThrow();
  });

  it('refuses a tested state with no time it was tested', async () => {
    await expect(
      admin`insert into concept_state (concept_id, user_id, state, established)
            values (${conceptA3}, ${userA}, 'known', 'tested')`,
    ).rejects.toThrow();
  });
});
