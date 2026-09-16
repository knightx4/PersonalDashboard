import { describe, expect, it } from 'vitest';
import { loadConceptView } from './concept';

/**
 * What the concept page is handed, and what it is handed for an id that is
 * not yours.
 *
 * The client is stubbed rather than run against Postgres: the isolation
 * itself is the database's and is asserted in tests/rls-learn-graph, so what
 * is worth checking here is what this file does with what comes back. A
 * concept somebody else owns reaches the reader as no row at all, and the
 * page has to turn that into a 404 rather than into an empty page about
 * nothing.
 */

type Row = Record<string, unknown>;

/**
 * Enough of the query builder for four plain reads: a filter, an ordering,
 * and either one row or all of them. Every step returns the same object, so
 * `.eq(...).order(...)` and `.eq(...).maybeSingle()` both work and awaiting
 * it directly gives the rows that survived the filters.
 */
function clientHolding(tables: {
  subjects?: Row[];
  concepts?: Row[];
  concept_edges?: Row[];
  concept_mentions?: Row[];
  concept_state?: Row[];
}) {
  return {
    from(table: string) {
      let rows = [...((tables as Record<string, Row[] | undefined>)[table] ?? [])];
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => {
          rows = rows.filter((row) => row[column] === value);
          return query;
        },
        in: (column: string, values: unknown[]) => {
          rows = rows.filter((row) => values.includes(row[column]));
          return query;
        },
        order: () => Promise.resolve({ data: rows, error: null }),
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        then: (resolve: (value: { data: Row[]; error: null }) => void) =>
          resolve({ data: rows, error: null }),
      };
      return query as never;
    },
  } as never;
}

const SUBJECT = { id: 'subject-1', name: 'Macro', note: null, created_at: '2026-01-01' };

function concept(id: string, name: string, rewritten?: { original: string; at: string }) {
  return {
    id,
    name,
    claim: `${name} is the claim`,
    claim_original: rewritten?.original ?? null,
    claim_rewritten_at: rewritten?.at ?? null,
    basis: `${name} is here because`,
    subject_id: 'subject-1',
  };
}

const GRAPH = {
  subjects: [SUBJECT],
  concepts: [
    concept('money', 'Money'),
    concept('prices', 'Prices', {
      original: 'What the app wrote about prices',
      at: '2026-03-14T10:00:00Z',
    }),
    concept('inflation', 'Inflation'),
  ],
  concept_edges: [
    { prerequisite_id: 'money', dependent_id: 'prices', subject_id: 'subject-1' },
    { prerequisite_id: 'prices', dependent_id: 'inflation', subject_id: 'subject-1' },
  ],
  concept_mentions: [
    // Both directions between the same pair, which an edge could not carry.
    { source_id: 'money', target_id: 'inflation', basis: 'The money section names inflation.', subject_id: 'subject-1' },
    { source_id: 'inflation', target_id: 'money', basis: 'The inflation section argues back at it.', subject_id: 'subject-1' },
  ],
  concept_state: [
    {
      concept_id: 'prices',
      state: 'shaky',
      established: 'tested',
      misconception: null,
      tested_at: '2026-02-02',
    },
  ],
};

describe('one concept, with what sits either side of it', () => {
  it('reads the concept and the subject it belongs to', async () => {
    const view = await loadConceptView(clientHolding(GRAPH), 'prices');

    expect(view?.concept.name).toBe('Prices');
    expect(view?.concept.claim).toBe('Prices is the claim');
    expect(view?.concept.state).toBe('shaky');
    expect(view?.concept.established).toBe('tested');
    expect(view?.subject.name).toBe('Macro');
  });

  it('carries the kept wording and the date, so the page can say whose words these are', async () => {
    const view = await loadConceptView(clientHolding(GRAPH), 'prices');

    expect(view?.concept.claimOriginal).toBe('What the app wrote about prices');
    expect(view?.concept.claimRewrittenAt).toBe('2026-03-14T10:00:00Z');
  });

  it('reads a claim nobody has rewritten as having neither', async () => {
    const view = await loadConceptView(clientHolding(GRAPH), 'money');

    expect(view?.concept.claimOriginal).toBeNull();
    expect(view?.concept.claimRewrittenAt).toBeNull();
  });

  it('names what it rests on and what rests on it, in both directions', async () => {
    const view = await loadConceptView(clientHolding(GRAPH), 'prices');

    expect(view?.prerequisites.map((row) => row.id)).toEqual(['money']);
    expect(view?.dependents.map((row) => row.id)).toEqual(['inflation']);
  });

  it('gives an end of the chain empty lists rather than nothing', async () => {
    const view = await loadConceptView(clientHolding(GRAPH), 'money');

    expect(view?.prerequisites).toEqual([]);
    expect(view?.dependents.map((row) => row.id)).toEqual(['prices']);
  });

  it('names what it refers to and what refers to it', async () => {
    const view = await loadConceptView(clientHolding(GRAPH), 'money');

    expect(view?.refersTo.map((row) => row.concept.id)).toEqual(['inflation']);
    expect(view?.refersTo[0].basis).toBe('The money section names inflation.');
    expect(view?.referredToBy.map((row) => row.concept.id)).toEqual(['inflation']);
  });

  it('gives a concept nobody mentions empty lists, not an absence', async () => {
    // The page reads the length to decide whether to show a heading at all, so
    // the lists are always there and sometimes empty.
    const view = await loadConceptView(clientHolding(GRAPH), 'prices');

    expect(view?.refersTo).toEqual([]);
    expect(view?.referredToBy).toEqual([]);
  });

  it('has nothing to show for a concept belonging to somebody else', async () => {
    // RLS returns no row rather than an error, so this is exactly the shape a
    // reader sees for another account's id: the concept simply is not there.
    const view = await loadConceptView(clientHolding({ subjects: [], concepts: [] }), 'prices');

    expect(view).toBeNull();
  });

  it('has nothing to show for a concept that has been deleted', async () => {
    const view = await loadConceptView(clientHolding(GRAPH), 'no-such-concept');

    expect(view).toBeNull();
  });
});
