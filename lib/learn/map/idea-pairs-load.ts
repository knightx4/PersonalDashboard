import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import type { KnowledgeState, StateBasis } from '@/lib/learn/graph/model';
import { SIMILAR_PAIR_THRESHOLD } from './idea-map';
import type { IdeaPair, PairIdea } from './idea-pairs';

/**
 * Reading the pairs still to settle (plan #2147.2).
 *
 * `learn.cross_subject_idea_pairs` finds them in the database, where the
 * vectors are, so nothing a thousand numbers wide crosses the wire. Then the
 * few ideas named are read with their subject, state, answers and links.
 * Through the person's session RLS narrows every read to their own rows.
 */

type PairRow = { a_id: string; b_id: string; similarity: number };
type ConceptRow = { id: string; name: string; claim: string; subject_id: string };
type StateRow = { concept_id: string; state: KnowledgeState; established: StateBasis };
type SubjectRow = { id: string; name: string };
type EdgeRow = { prerequisite_id: string; dependent_id: string };

function fail(what: string, error: { message: string }): Error {
  return new Error(`${what} failed: ${error.message}`);
}

export async function loadIdeaPairs(learn: LearnSupabaseClient): Promise<IdeaPair[]> {
  const { data, error } = await learn.rpc('cross_subject_idea_pairs', {
    min_similarity: SIMILAR_PAIR_THRESHOLD,
  });
  if (error) throw fail('Finding the same idea in two subjects', error);
  const pairs = (data ?? []) as PairRow[];
  if (pairs.length === 0) return [];

  const ids = [...new Set(pairs.flatMap((pair) => [pair.a_id, pair.b_id]))];
  const [concepts, states, probes, edgesFrom, edgesTo] = await Promise.all([
    learn.from('concepts').select('id, name, claim, subject_id').in('id', ids),
    learn.from('concept_state').select('concept_id, state, established').in('concept_id', ids),
    learn.from('probes').select('concept_id').in('concept_id', ids).not('answered_at', 'is', null),
    learn.from('concept_edges').select('prerequisite_id, dependent_id').in('prerequisite_id', ids),
    learn.from('concept_edges').select('prerequisite_id, dependent_id').in('dependent_id', ids),
  ]);
  for (const [what, result] of [
    ['Reading the ideas', concepts],
    ['Reading where you stand on them', states],
    ['Reading your answers', probes],
    ['Reading their links', edgesFrom],
    ['Reading their links', edgesTo],
  ] as const) {
    if (result.error) throw fail(what, result.error);
  }

  const conceptRows = (concepts.data ?? []) as ConceptRow[];
  const subjectIds = [...new Set(conceptRows.map((row) => row.subject_id))];
  const subjects = await learn.from('subjects').select('id, name').in('id', subjectIds);
  if (subjects.error) throw fail('Reading the subjects', subjects.error);

  const subjectName = new Map(((subjects.data ?? []) as SubjectRow[]).map((row) => [row.id, row.name]));
  const stateOf = new Map(((states.data ?? []) as StateRow[]).map((row) => [row.concept_id, row]));
  const answers = new Map<string, number>();
  for (const row of (probes.data ?? []) as { concept_id: string }[]) {
    answers.set(row.concept_id, (answers.get(row.concept_id) ?? 0) + 1);
  }
  // An edge between two of the ideas comes back from both reads; count it once.
  const edges = new Map<string, EdgeRow>();
  for (const row of [...(edgesFrom.data ?? []), ...(edgesTo.data ?? [])] as EdgeRow[]) {
    edges.set(`${row.prerequisite_id}:${row.dependent_id}`, row);
  }
  const links = new Map<string, number>();
  for (const edge of edges.values()) {
    for (const id of [edge.prerequisite_id, edge.dependent_id]) links.set(id, (links.get(id) ?? 0) + 1);
  }

  const ideas = new Map<string, PairIdea>(
    conceptRows.map((row) => {
      const state = stateOf.get(row.id);
      return [
        row.id,
        {
          id: row.id,
          name: row.name,
          claim: row.claim,
          subject: { id: row.subject_id, name: subjectName.get(row.subject_id) ?? 'A subject' },
          state: state?.state ?? null,
          established: state?.established ?? null,
          answers: answers.get(row.id) ?? 0,
          links: links.get(row.id) ?? 0,
        },
      ];
    }),
  );

  return pairs.flatMap((pair) => {
    const a = ideas.get(pair.a_id);
    const b = ideas.get(pair.b_id);
    return a && b ? [{ a, b, similarity: pair.similarity }] : [];
  });
}

/** One pair still to settle, or null when it is settled or is not a pair. */
export async function loadIdeaPair(learn: LearnSupabaseClient, a: string, b: string): Promise<IdeaPair | null> {
  const pairs = await loadIdeaPairs(learn);
  return pairs.find((pair) => (pair.a.id === a && pair.b.id === b) || (pair.a.id === b && pair.b.id === a)) ?? null;
}
