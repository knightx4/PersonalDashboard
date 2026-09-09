import { describe, expect, it } from 'vitest';
import { chainPayloadSchema, MAX_CHAIN, normaliseChain, type ExistingConcept } from './chain-payload';

/**
 * What a generated chain has to survive before anybody sees it.
 *
 * Every case here is a way a generated graph is wrong that looks fine on the
 * screen: the same concept added twice under slightly different words, a node
 * nobody said where to put, an edge that would make the graph un-walkable. A
 * wrong graph is worse than no graph, and these are the wrongnesses that do
 * not announce themselves.
 */

const parse = (input: unknown) => chainPayloadSchema.parse(input);

const node = (name: string) => ({
  name,
  claim: `${name} is the case, for a reason.`,
  basis: 'Standard in any intermediate sequence.',
});

const edge = (prerequisite: string, dependent: string) => ({
  prerequisite,
  dependent,
  basis: 'One rests on the other.',
});

const nothingExists: ExistingConcept[] = [];

describe('a straightforward chain', () => {
  it('comes back in one piece', () => {
    const chain = normaliseChain(
      parse({
        subject: 'Economics',
        goal_concept: 'C',
        concepts: [node('A'), node('B'), node('C')],
        edges: [edge('A', 'B'), edge('B', 'C')],
      }),
      nothingExists,
    );

    expect(chain).not.toBeNull();
    expect(chain!.nodes.map((n) => n.name)).toEqual(['A', 'B', 'C']);
    expect(chain!.edges).toHaveLength(2);
    expect(chain!.joined).toBe(0);
  });
});

describe('joining what is already there', () => {
  it('matches an existing concept by name and does not propose it again', () => {
    const chain = normaliseChain(
      parse({
        subject: 'Economics',
        goal_concept: 'C',
        concepts: [node('A'), node('B'), node('C')],
        edges: [edge('A', 'B'), edge('B', 'C')],
      }),
      [{ id: 'existing-a', name: 'a' }],
    );

    // Kept in the chain -- it is a rung, and the chain is unreadable without
    // it -- but carrying the id it matched, so nothing inserts it twice.
    expect(chain!.nodes[0]).toMatchObject({ name: 'A', existingId: 'existing-a' });
    expect(chain!.nodes[1].existingId).toBeNull();
    expect(chain!.joined).toBe(1);
  });

  it('matches regardless of case', () => {
    const chain = normaliseChain(
      parse({
        subject: 'Economics',
        goal_concept: 'B',
        concepts: [node('Wage Stickiness'), node('B')],
        edges: [edge('Wage Stickiness', 'B')],
      }),
      [{ id: 'existing', name: 'wage stickiness' }],
    );

    expect(chain!.nodes[0].existingId).toBe('existing');
  });

  it('proposes nothing when everything was already known', () => {
    // A month later, the same goal. There is no chain here, and saying so
    // beats a screen of rows with nothing to approve.
    const chain = normaliseChain(
      parse({
        subject: 'Economics',
        goal_concept: 'B',
        concepts: [node('A'), node('B')],
        edges: [edge('A', 'B')],
      }),
      [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
    );

    expect(chain).toBeNull();
  });

  it('drops a concept the model proposed twice', () => {
    const chain = normaliseChain(
      parse({
        subject: 'Economics',
        goal_concept: 'B',
        concepts: [node('A'), node('a'), node('B')],
        edges: [edge('A', 'B')],
      }),
      nothingExists,
    );

    expect(chain!.nodes.map((n) => n.name)).toEqual(['A', 'B']);
    expect(chain!.dropped.some((d) => d.reason === 'proposed twice')).toBe(true);
  });
});

describe('nothing is added without an edge', () => {
  it('drops a new node nothing was said about', () => {
    const chain = normaliseChain(
      parse({
        subject: 'Economics',
        goal_concept: 'B',
        concepts: [node('A'), node('B'), node('Floating')],
        edges: [edge('A', 'B')],
      }),
      nothingExists,
    );

    expect(chain!.nodes.map((n) => n.name)).toEqual(['A', 'B']);
    expect(chain!.dropped[0]).toMatchObject({ name: 'Floating' });
  });

  it('ignores an edge naming something that is not in the chain', () => {
    // Drawing it would mean inventing the missing end, which is the silent
    // guess this module is built against.
    const chain = normaliseChain(
      parse({
        subject: 'Economics',
        goal_concept: 'B',
        concepts: [node('A'), node('B')],
        edges: [edge('A', 'B'), edge('B', 'Ghost')],
      }),
      nothingExists,
    );

    expect(chain!.edges).toHaveLength(1);
  });
});

describe('the graph stays walkable', () => {
  it('refuses an edge that would close a loop', () => {
    const chain = normaliseChain(
      parse({
        subject: 'Economics',
        goal_concept: 'C',
        concepts: [node('A'), node('B'), node('C')],
        edges: [edge('A', 'B'), edge('B', 'C'), edge('C', 'A')],
      }),
      nothingExists,
    );

    expect(chain!.edges).toHaveLength(2);
    expect(chain!.dropped.some((d) => d.reason === 'would close a loop')).toBe(true);
  });

  it('refuses a concept that is its own prerequisite', () => {
    const chain = normaliseChain(
      parse({
        subject: 'Economics',
        goal_concept: 'B',
        concepts: [node('A'), node('B')],
        edges: [edge('A', 'B'), edge('A', 'A')],
      }),
      nothingExists,
    );

    expect(chain!.edges).toHaveLength(1);
  });

  it('drops a repeated edge rather than saving it twice', () => {
    const chain = normaliseChain(
      parse({
        subject: 'Economics',
        goal_concept: 'B',
        concepts: [node('A'), node('B')],
        edges: [edge('A', 'B'), edge('A', 'B')],
      }),
      nothingExists,
    );

    expect(chain!.edges).toHaveLength(1);
  });
});

describe('a chain that ran away with itself', () => {
  it('is cut to the cap', () => {
    const many = Array.from({ length: 30 }, (_, i) => node(`N${i}`));
    const edges = many.slice(1).map((n, i) => edge(`N${i}`, n.name));

    const chain = normaliseChain(
      parse({ subject: 'Economics', goal_concept: 'N0', concepts: many, edges }),
      nothingExists,
    );

    expect(chain!.nodes.length).toBeLessThanOrEqual(MAX_CHAIN);
  });
});

describe('when there is nothing to propose', () => {
  it('says so for a goal too vague to lay out', () => {
    expect(
      normaliseChain(
        parse({ subject: 'Science', goal_concept: 'everything', too_vague: true, concepts: [] }),
        nothingExists,
      ),
    ).toBeNull();
  });

  it('says so when the goal node itself never turned up', () => {
    // Without the node the goal resolves to, there is no goal -- only a pile
    // of concepts around where it should have been.
    expect(
      normaliseChain(
        parse({
          subject: 'Economics',
          goal_concept: 'The point of all this',
          concepts: [node('A'), node('B')],
          edges: [edge('A', 'B')],
        }),
        nothingExists,
      ),
    ).toBeNull();
  });

  it('says so for an empty proposal', () => {
    expect(
      normaliseChain(
        parse({ subject: 'Economics', goal_concept: 'A', concepts: [], edges: [] }),
        nothingExists,
      ),
    ).toBeNull();
  });
});
