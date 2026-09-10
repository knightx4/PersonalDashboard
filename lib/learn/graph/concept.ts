import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { loadGraph, loadSubject, subjectIdOfConcept, type Subject } from '@/lib/learn/graph/load';
import {
  dependentMap,
  learningOrder,
  prerequisiteMap,
  type Concept,
} from '@/lib/learn/graph/model';

/**
 * One concept, with the subject around it and the nodes either side.
 *
 * The graph is read whole and the neighbours picked out of it in memory,
 * which is the same three reads the subject page already makes -- a personal
 * graph is hundreds of rows, and a page that asked the database for a
 * concept's prerequisites separately would be a fourth query saving nothing.
 *
 * Null is the answer to every way this can fail to find something: a deleted
 * concept, an id that never existed, and an id belonging to somebody else,
 * which RLS turns into no row rather than into an error. The page turns all
 * three into a 404, and none of them is worth telling apart on screen --
 * saying "that concept is not yours" would confirm it exists.
 */
export type ConceptView = {
  subject: Subject;
  concept: Concept;
  /** What it rests on, in the order they would be learned. */
  prerequisites: Concept[];
  /** What rests on it, same order. */
  dependents: Concept[];
};

export async function loadConceptView(
  supabase: LearnSupabaseClient,
  conceptId: string,
): Promise<ConceptView | null> {
  const subjectId = await subjectIdOfConcept(supabase, conceptId);
  if (!subjectId) return null;

  const [subject, graph] = await Promise.all([
    loadSubject(supabase, subjectId),
    loadGraph(supabase, subjectId),
  ]);

  const concept = graph.concepts.find((row) => row.id === conceptId);
  if (!subject || !concept) return null;

  return {
    subject,
    concept,
    prerequisites: learningOrder(graph, prerequisiteMap(graph).get(conceptId) ?? []),
    dependents: learningOrder(graph, dependentMap(graph).get(conceptId) ?? []),
  };
}
