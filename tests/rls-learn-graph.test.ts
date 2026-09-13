/**
 * Cross-user isolation for the graph half of the learn module, and the one
 * property the whole thing rests on: no cycles.
 *
 * The isolation half is the same rule as everywhere else, applied to seven new
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
let sweepA = '';

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

async function seedSweep(userId: string, asked: string, subjectName: string): Promise<string> {
  const [row] = await admin<{ id: string }[]>`
    insert into opening_sweeps (user_id, asked, subject_name)
    values (${userId}, ${asked}, ${subjectName}) returning id`;
  return row.id;
}

async function seedOpeningQuestion(
  userId: string,
  sweepId: string,
  position: number,
  claimName: string,
): Promise<string> {
  const [row] = await admin<{ id: string }[]>`
    insert into opening_questions
      (user_id, sweep_id, position, claim_name, claim, question, expected)
    values (${userId}, ${sweepId}, ${position}, ${claimName},
            'A claim somebody can be right or wrong about.',
            'What does it rule out?', 'The model answer.')
    returning id`;
  return row.id;
}

async function seedMention(
  userId: string,
  subjectId: string,
  source: string,
  target: string,
): Promise<void> {
  await admin`
    insert into concept_mentions (user_id, subject_id, source_id, target_id, basis)
    values (${userId}, ${subjectId}, ${source}, ${target}, 'Seeded by the test.')`;
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

  // Both directions between the same pair, which is what an edge could never
  // be: the cycle trigger below refuses exactly that shape.
  await seedMention(userA, subjectA, conceptA1, conceptA3);
  await seedMention(userA, subjectA, conceptA3, conceptA1);

  // tested_at goes in the insert, not an update after it. The constraint the
  // suite below checks -- established = 'tested' needs a time it was tested --
  // refuses the two-step version outright, and it refuses it in beforeAll,
  // where vitest reports the whole file as skipped rather than as failing.
  await admin`
    insert into concept_state (concept_id, user_id, state, established, misconception, tested_at)
    values (${conceptA2}, ${userA}, 'misconception', 'tested',
            'Believes the tradeoff is permanent rather than expectations-dependent.',
            now())`;

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

  // A sweep sits outside the graph until a chain is approved -- no subject, no
  // concepts -- which is why it needs its own seeding here rather than hanging
  // off one of the rows above.
  sweepA = await seedSweep(userA, 'keynesian economics', 'Economics');
  await seedOpeningQuestion(userA, sweepA, 0, 'Wage stickiness');
  await seedOpeningQuestion(userA, sweepA, 1, 'Liquidity trap');
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
      union all select 'concept_mentions', count(*)::int from concept_mentions
      union all select 'goals', count(*)::int from goals
      union all select 'concept_state', count(*)::int from concept_state
      union all select 'probes', count(*)::int from probes
      union all select 'opening_sweeps', count(*)::int from opening_sweeps
      union all select 'opening_questions', count(*)::int from opening_questions
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
      mentions: (await tx`select id from concept_mentions`).length,
      goals: (await tx`select id from goals`).length,
      state: (await tx`select concept_id from concept_state`).length,
      probes: (await tx`select id from probes`).length,
      sweeps: (await tx`select id from opening_sweeps`).length,
      openingQuestions: (await tx`select id from opening_questions`).length,
    }));
    expect(seen).toEqual({
      subjects: 1,
      concepts: 3,
      edges: 2,
      mentions: 2,
      goals: 1,
      state: 1,
      probes: 1,
      sweeps: 1,
      openingQuestions: 2,
    });
  });

  it('shows another user none of it', async () => {
    const seen = await asUser(userB, async (tx) => ({
      subjects: (await tx`select id from subjects where id = ${subjectA}`).length,
      concepts: (await tx`select id from concepts where subject_id = ${subjectA}`).length,
      edges: (await tx`select id from concept_edges where subject_id = ${subjectA}`).length,
      mentions: (await tx`select id from concept_mentions where subject_id = ${subjectA}`).length,
      goals: (await tx`select id from goals where subject_id = ${subjectA}`).length,
      state: (await tx`select concept_id from concept_state where concept_id = ${conceptA2}`).length,
      probes: (await tx`select id from probes where concept_id = ${conceptA2}`).length,
      sweeps: (await tx`select id from opening_sweeps where id = ${sweepA}`).length,
      openingQuestions: (await tx`select id from opening_questions where sweep_id = ${sweepA}`).length,
    }));
    expect(seen).toEqual({
      subjects: 0,
      concepts: 0,
      edges: 0,
      mentions: 0,
      goals: 0,
      state: 0,
      probes: 0,
      sweeps: 0,
      openingQuestions: 0,
    });
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

describe('one claim referring to another', () => {
  /**
   * The second relation, and the rules that keep it from becoming the first.
   * Both directions at once is the case an edge cannot carry -- the cycle
   * trigger refuses it -- and it is the ordinary case here, already seeded
   * above.
   */
  it('refuses the same direction twice', async () => {
    await expect(seedMention(userA, subjectA, conceptA1, conceptA3)).rejects.toThrow();
  });

  it('refuses a claim referring to itself', async () => {
    await expect(seedMention(userA, subjectA, conceptA1, conceptA1)).rejects.toThrow();
  });

  it('refuses one with no stated basis', async () => {
    await expect(
      admin`insert into concept_mentions (user_id, subject_id, source_id, target_id, basis)
            values (${userA}, ${subjectA}, ${conceptA2}, ${conceptA3}, '')`,
    ).rejects.toThrow();
  });

  it('refuses one whose ends are in different subjects', async () => {
    await expect(seedMention(userA, subjectA, conceptA1, conceptB1)).rejects.toThrow();
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

describe('what understanding a concept looks like', () => {
  // The checks are what a probe question gets written against, so the shape of
  // the list is a database fact rather than a promise the model makes: one
  // check is a restatement of the claim and five is a syllabus for it.
  async function seedWithMastery(checks: (string | number)[]): Promise<void> {
    await admin`
      insert into concepts (user_id, subject_id, name, claim, basis, mastery)
      values (${userA}, ${subjectA}, 'Wage stickiness', 'Wages lag prices.',
              'Seeded by the test.', ${admin.json(checks)}::jsonb)`;
  }

  it('keeps a concept whose checks were never written', async () => {
    const [row] = await admin<{ mastery: unknown }[]>`
      insert into concepts (user_id, subject_id, name, claim, basis)
      values (${userA}, ${subjectA}, 'No checks', 'A claim with nothing said about it.',
              'Seeded by the test.')
      returning mastery`;
    expect(row.mastery).toBeNull();
  });

  it('reads three checks back in the order they were written', async () => {
    const written = ['Rules out a pay freeze.', 'Applies at 4% inflation.', 'The Lucas objection.'];
    const [row] = await admin<{ mastery: string[] }[]>`
      insert into concepts (user_id, subject_id, name, claim, basis, mastery)
      values (${userA}, ${subjectA}, 'Three checks', 'Wages lag prices.',
              'Seeded by the test.', ${admin.json(written)}::jsonb)
      returning mastery`;
    expect(row.mastery).toEqual(written);
  });

  it('refuses a single check', async () => {
    await expect(seedWithMastery(['The only thing said about it.'])).rejects.toThrow();
  });

  it('refuses five checks', async () => {
    await expect(seedWithMastery(['One.', 'Two.', 'Three.', 'Four.', 'Five.'])).rejects.toThrow();
  });

  it('refuses a blank check beside a real one', async () => {
    await expect(seedWithMastery(['A real check.', '   '])).rejects.toThrow();
  });

  it('refuses a list holding something that is not a string', async () => {
    await expect(seedWithMastery(['A real check.', 3])).rejects.toThrow();
  });
});

describe('which check a question was written against', () => {
  async function seedProbe(masteryCheck: string | null): Promise<void> {
    await admin`
      insert into probes (user_id, concept_id, question, options, correct_index, reason,
                          mastery_check)
      values (${userA}, ${conceptA1}, 'What follows?',
              ${admin.json(['It steepens', 'It vanishes'])}, 1, 'Because of the mechanism.',
              ${masteryCheck})`;
  }

  it('stores the check as the text it was at the time', async () => {
    await seedProbe('Rules out a pay freeze.');
    const [row] = await admin<{ mastery_check: string }[]>`
      select mastery_check from probes where concept_id = ${conceptA1}
      order by created_at desc limit 1`;
    expect(row.mastery_check).toBe('Rules out a pay freeze.');
  });

  it('takes a question about a concept with no checks', async () => {
    await seedProbe(null);
    const [row] = await admin<{ mastery_check: string | null }[]>`
      select mastery_check from probes where concept_id = ${conceptA1}
      order by created_at desc limit 1`;
    expect(row.mastery_check).toBeNull();
  });

  it('refuses an empty one', async () => {
    // Empty would read as "no check" in the database and as "a check"
    // everywhere else.
    await expect(seedProbe('')).rejects.toThrow();
  });
});

describe('which concepts are doors into the subject', () => {
  // Two values and no third, and the absence of one is what an unjudged
  // concept looks like. A default here would say something nobody checked.
  it('leaves a concept written without a mark unsaid', async () => {
    const [row] = await admin<{ kind: string | null }[]>`
      insert into concepts (user_id, subject_id, name, claim, basis)
      values (${userA}, ${subjectA}, 'Unmarked', 'A claim nobody has judged.',
              'Seeded by the test.')
      returning kind`;
    expect(row.kind).toBeNull();
  });

  it('stores a door and a consequence', async () => {
    const [door] = await admin<{ kind: string }[]>`
      insert into concepts (user_id, subject_id, name, claim, basis, kind)
      values (${userA}, ${subjectA}, 'Opportunity cost', 'Every choice costs the next best one.',
              'Seeded by the test.', 'threshold')
      returning kind`;
    expect(door.kind).toBe('threshold');

    const [downstream] = await admin<{ kind: string }[]>`
      insert into concepts (user_id, subject_id, name, claim, basis, kind)
      values (${userA}, ${subjectA}, 'Sunk cost', 'Spent money is not a reason to continue.',
              'Seeded by the test.', 'consequence')
      returning kind`;
    expect(downstream.kind).toBe('consequence');
  });

  it('refuses anything but those two', async () => {
    await expect(
      admin`insert into concepts (user_id, subject_id, name, claim, basis, kind)
            values (${userA}, ${subjectA}, 'Maybe', 'A claim with a hedged mark.',
                    'Seeded by the test.', 'unsure')`,
    ).rejects.toThrow();
  });
});

describe('the ten questions asked before a subject exists', () => {
  /**
   * A sweep is written before there is anything to attach it to, so the rules
   * that keep it honest are all on its own two tables: an answer you cannot
   * read is not an answer, a pass stores nothing, and the order is fixed at
   * write time rather than left to how rows come back.
   */
  it('starts with no subject, and takes one once a chain is approved', async () => {
    const id = await seedSweep(userA, 'the phillips curve', 'Economics');
    const [before] = await admin<{ subject_id: string | null }[]>`
      select subject_id from opening_sweeps where id = ${id}`;
    expect(before.subject_id).toBeNull();

    await admin`update opening_sweeps set subject_id = ${subjectA} where id = ${id}`;
    const [after] = await admin<{ subject_id: string | null }[]>`
      select subject_id from opening_sweeps where id = ${id}`;
    expect(after.subject_id).toBe(subjectA);
  });

  it('reads a half-answered sweep back with the right number outstanding', async () => {
    const id = await seedSweep(userA, 'monetary policy', 'Economics');
    const first = await seedOpeningQuestion(userA, id, 0, 'One');
    const second = await seedOpeningQuestion(userA, id, 1, 'Two');
    await seedOpeningQuestion(userA, id, 2, 'Three');

    // One answered, one passed, one not reached. A pass counts as reached:
    // somebody who pressed past every question has finished the sweep.
    await admin`update opening_questions
                set response = 'Wages lag prices.', outcome = 'right', answered_at = now()
                where id = ${first}`;
    await admin`update opening_questions
                set outcome = 'skipped', answered_at = now() where id = ${second}`;

    const rows = await admin<{ position: number; outcome: string | null }[]>`
      select position, outcome from opening_questions where sweep_id = ${id} order by position`;
    expect(rows.map((r) => r.outcome)).toEqual(['right', 'skipped', null]);
    expect(rows.filter((r) => r.outcome === null)).toHaveLength(1);
  });

  it('refuses a graded answer with nothing written', async () => {
    const id = await seedSweep(userA, 'fiscal policy', 'Economics');
    const question = await seedOpeningQuestion(userA, id, 0, 'One');
    await expect(
      admin`update opening_questions set outcome = 'wrong', answered_at = now()
            where id = ${question}`,
    ).rejects.toThrow();
  });

  it('refuses a pass that carries an answer', async () => {
    const id = await seedSweep(userA, 'trade', 'Economics');
    const question = await seedOpeningQuestion(userA, id, 0, 'One');
    await expect(
      admin`update opening_questions
            set response = 'Something', outcome = 'skipped', answered_at = now()
            where id = ${question}`,
    ).rejects.toThrow();
  });

  it('refuses an outcome with no time it was answered', async () => {
    const id = await seedSweep(userA, 'growth', 'Economics');
    const question = await seedOpeningQuestion(userA, id, 0, 'One');
    await expect(
      admin`update opening_questions set response = 'A guess.', outcome = 'right'
            where id = ${question}`,
    ).rejects.toThrow();
  });

  it('refuses two questions in the same place in the order', async () => {
    const id = await seedSweep(userA, 'inflation', 'Economics');
    await seedOpeningQuestion(userA, id, 0, 'One');
    await expect(seedOpeningQuestion(userA, id, 0, 'Also one')).rejects.toThrow();
  });

  it('refuses a question with no model answer to grade against', async () => {
    const id = await seedSweep(userA, 'unemployment', 'Economics');
    await expect(
      admin`insert into opening_questions
              (user_id, sweep_id, position, claim_name, claim, question, expected)
            values (${userA}, ${id}, 0, 'One', 'A claim.', 'A question?', '')`,
    ).rejects.toThrow();
  });

  it('takes the sweep questions with it when it goes', async () => {
    const id = await seedSweep(userA, 'money supply', 'Economics');
    await seedOpeningQuestion(userA, id, 0, 'One');
    await admin`delete from opening_sweeps where id = ${id}`;
    const left = await admin`select id from opening_questions where sweep_id = ${id}`;
    expect(left).toHaveLength(0);
  });

  it('does not let another user read what you could not answer', async () => {
    const rows = await asUser(
      userB,
      (tx) => tx`select question, response from opening_questions where sweep_id = ${sweepA}`,
    );
    expect(rows).toHaveLength(0);
  });

  it('does not let another user add a question to your sweep', async () => {
    await expect(
      asUser(
        userB,
        (tx) => tx`insert into opening_questions
                     (user_id, sweep_id, position, claim_name, claim, question, expected)
                   values (${userB}, ${sweepA}, 9, 'Mallory', 'A claim.', 'A question?', 'An answer.')
                   returning id`,
      ),
    ).rejects.toThrow();
  });

  it('does not let another user answer for you', async () => {
    const affected = await asUser(
      userB,
      (tx) => tx`update opening_questions
                 set response = 'Not mine', outcome = 'right', answered_at = now()
                 where sweep_id = ${sweepA} returning id`,
    );
    expect(affected).toHaveLength(0);
  });
});
