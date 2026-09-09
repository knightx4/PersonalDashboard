import { describe, expect, it } from 'vitest';
import { saveChain } from './save';
import type { ProposedChain } from './chain-payload';

/**
 * What actually reaches the database when a chain is approved.
 *
 * Stubbed rather than run against Postgres, because what is worth checking
 * here is the shape of the writes: that a node the chain matched against the
 * subject is not inserted a second time, that edges are resolved to the ids
 * that came back rather than to names, and that the goal keeps the words the
 * person typed rather than the tidy name the model gave its node.
 *
 * The guarantees themselves -- no cycles, no duplicate pairs, no cross-account
 * link -- belong to the database and are asserted in tests/rls-learn-graph.
 */

type Insert = { table: string; rows: unknown };

/**
 * A stand-in for the session client.
 *
 * Enough of the builder to record what each insert was handed, and to give the
 * concepts insert its rows back, which is how the edges find their ids.
 */
function clientReturningIds(existingSubject: string | null = null) {
  const inserts: Insert[] = [];

  const client = {
    from(table: string) {
      return {
        select: () => ({
          ilike: () => ({
            maybeSingle: async () =>
              existingSubject ? { data: { id: existingSubject }, error: null } : { data: null, error: null },
          }),
          eq: () => ({ order: async () => ({ data: [], error: null }) }),
        }),
        insert: (rows: unknown) => {
          inserts.push({ table, rows });
          const list = (Array.isArray(rows) ? rows : [rows]) as { name?: string }[];
          const result = {
            select: () => ({
              single: async () => ({ data: { id: `${table}-id` }, error: null }),
              then: (resolve: (v: { data: { id: string; name: string }[]; error: null }) => void) =>
                resolve({
                  data: list.map((row, index) => ({ id: `${table}-${index}`, name: row.name ?? '' })),
                  error: null,
                }),
            }),
            then: (resolve: (v: { error: null }) => void) => resolve({ error: null }),
          };
          return result as never;
        },
      } as never;
    },
  };

  return { client: client as never, inserts };
}

const CHAIN: ProposedChain = {
  subject: 'Economics',
  goalConcept: 'Expectations close the gap',
  nodes: [
    { name: 'Wage stickiness', claim: 'Wages lag prices.', basis: 'Standard.', existingId: 'already-here' },
    {
      name: 'Expectations close the gap',
      claim: 'The gain goes, the inflation stays.',
      basis: 'Standard.',
      existingId: null,
    },
  ],
  edges: [
    {
      prerequisite: 'Wage stickiness',
      dependent: 'Expectations close the gap',
      basis: 'The gap opens because wages lag.',
    },
  ],
  joined: 1,
  dropped: [],
};

const rowsFor = (inserts: Insert[], table: string) =>
  inserts.filter((insert) => insert.table === table).flatMap((insert) => insert.rows as never[]);

describe('saving an approved chain', () => {
  it('inserts only the concepts that are new', async () => {
    const { client, inserts } = clientReturningIds('subject-1');
    const saved = await saveChain(client, 'user-1', CHAIN, 'how rates reach prices');

    const concepts = rowsFor(inserts, 'concepts') as { name: string; origin: string }[];
    expect(concepts).toHaveLength(1);
    expect(concepts[0].name).toBe('Expectations close the gap');
    expect(concepts[0].origin).toBe('generated');
    expect(saved.conceptsAdded).toBe(1);
  });

  it('joins the new node to the one that was already there', async () => {
    // The reason a second goal in the same subject is worth asking for: the
    // edge from what you knew to what you just added.
    const { client, inserts } = clientReturningIds('subject-1');
    await saveChain(client, 'user-1', CHAIN, 'how rates reach prices');

    const edges = rowsFor(inserts, 'concept_edges') as {
      prerequisite_id: string;
      dependent_id: string;
    }[];
    expect(edges).toHaveLength(1);
    expect(edges[0].prerequisite_id).toBe('already-here');
    expect(edges[0].dependent_id).toBe('concepts-0');
  });

  it('keeps the words the person typed as the goal', async () => {
    const { client, inserts } = clientReturningIds('subject-1');
    await saveChain(client, 'user-1', CHAIN, 'how raising a policy rate reaches the price of anything');

    const goals = rowsFor(inserts, 'goals') as { asked: string; status: string }[];
    expect(goals[0].asked).toBe('how raising a policy rate reaches the price of anything');
    // Approved by the person looking at it, which is what makes it active.
    expect(goals[0].status).toBe('active');
  });

  it('creates the subject when it is a new one', async () => {
    const { client, inserts } = clientReturningIds(null);
    await saveChain(client, 'user-1', CHAIN, 'a goal');

    const subjects = rowsFor(inserts, 'subjects') as { name: string }[];
    expect(subjects).toHaveLength(1);
    expect(subjects[0].name).toBe('Economics');
  });

  it('does not create a subject that already exists', async () => {
    const { client, inserts } = clientReturningIds('subject-1');
    await saveChain(client, 'user-1', CHAIN, 'a goal');
    expect(rowsFor(inserts, 'subjects')).toHaveLength(0);
  });

  it('carries the user id on every row, since the policy compares it', async () => {
    const { client, inserts } = clientReturningIds('subject-1');
    await saveChain(client, 'user-1', CHAIN, 'a goal');

    for (const insert of inserts) {
      for (const row of Array.isArray(insert.rows) ? insert.rows : [insert.rows]) {
        expect((row as { user_id: string }).user_id).toBe('user-1');
      }
    }
  });
});

describe('a chain that adds nothing new', () => {
  it('writes no concepts and no edges it cannot resolve', async () => {
    const { client, inserts } = clientReturningIds('subject-1');
    await saveChain(
      client,
      'user-1',
      {
        ...CHAIN,
        nodes: [{ ...CHAIN.nodes[0] }],
        // The other end is not in the chain, so this edge cannot be drawn.
        edges: [{ prerequisite: 'Wage stickiness', dependent: 'Gone', basis: 'x' }],
      },
      'a goal',
    );

    expect(rowsFor(inserts, 'concepts')).toHaveLength(0);
    expect(rowsFor(inserts, 'concept_edges')).toHaveLength(0);
  });
});
