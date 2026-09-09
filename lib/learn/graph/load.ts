import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { LEARN_SCHEMA, type LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import type { Concept, Graph, KnowledgeState, StateBasis } from '@/lib/learn/graph/model';

/**
 * Reading a subject's graph.
 *
 * Every query goes through the session client, so RLS decides what comes back
 * and nothing here filters by user id. Three plain reads rather than embedded
 * ones, joined in memory: the links in this schema are composite, carrying
 * user_id so that a row from another account cannot be reached through a
 * foreign key, and that is not a thing to make PostgREST's relationship
 * detection responsible for. A personal graph is hundreds of rows.
 *
 * Nothing in this file writes, and nothing calls a model. That is the point of
 * the slice it belongs to -- the view is proved over a graph put there by hand
 * before generation exists to hide a bad one behind it.
 */

export type Subject = {
  id: string;
  name: string;
  note: string | null;
  createdAt: string;
};

export type Goal = {
  id: string;
  asked: string;
  conceptId: string | null;
  status: 'proposed' | 'active' | 'reached' | 'abandoned';
};

function fail(action: string, error: { message: string }): Error {
  return new Error(`${action} failed: ${error.message}`);
}

export async function loadSubjects(supabase: LearnSupabaseClient): Promise<Subject[]> {
  const { data, error } = await supabase
    .from('subjects')
    .select('id, name, note, created_at')
    .order('name');

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail('Reading your subjects', error);

  return (data ?? []).map((row) => {
    const subject = row as { id: string; name: string; note: string | null; created_at: string };
    return {
      id: subject.id,
      name: subject.name,
      note: subject.note,
      createdAt: subject.created_at,
    };
  });
}

export async function loadSubject(
  supabase: LearnSupabaseClient,
  id: string,
): Promise<Subject | null> {
  const { data, error } = await supabase
    .from('subjects')
    .select('id, name, note, created_at')
    .eq('id', id)
    .maybeSingle();

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail('Reading that subject', error);
  if (!data) return null;

  const subject = data as { id: string; name: string; note: string | null; created_at: string };
  return {
    id: subject.id,
    name: subject.name,
    note: subject.note,
    createdAt: subject.created_at,
  };
}

type ConceptRow = {
  id: string;
  name: string;
  claim: string;
  basis: string;
};

type StateRow = {
  concept_id: string;
  state: KnowledgeState;
  established: StateBasis;
  misconception: string | null;
  tested_at: string | null;
};

/**
 * A concept with no state row is unknown.
 *
 * The row is written the first time something is established, so its absence
 * is meaningful rather than missing: nothing has been found out about this
 * node yet, which is exactly `unknown`, inferred from nothing.
 */
function toConcept(row: ConceptRow, state: StateRow | undefined): Concept {
  return {
    id: row.id,
    name: row.name,
    claim: row.claim,
    basis: row.basis,
    state: state?.state ?? 'unknown',
    established: state?.established ?? 'inferred',
    misconception: state?.misconception ?? null,
    testedAt: state?.tested_at ?? null,
  };
}

export async function loadGraph(
  supabase: LearnSupabaseClient,
  subjectId: string,
): Promise<Graph> {
  const [
    { data: conceptRows, error: conceptError },
    { data: edgeRows, error: edgeError },
  ] = await Promise.all([
    supabase
      .from('concepts')
      .select('id, name, claim, basis')
      .eq('subject_id', subjectId)
      .order('name'),
    supabase
      .from('concept_edges')
      .select('prerequisite_id, dependent_id')
      .eq('subject_id', subjectId),
  ]);

  assertSchemaExposed(conceptError ?? edgeError, LEARN_SCHEMA);
  if (conceptError) throw fail('Reading the concepts', conceptError);
  if (edgeError) throw fail('Reading the prerequisites', edgeError);

  const concepts = (conceptRows ?? []) as unknown as ConceptRow[];

  // A third read rather than an embed. concept_state points at concepts on
  // (id, user_id), which is what makes a link across accounts impossible, and
  // a composite key is not something to make PostgREST's relationship
  // detection responsible for. Filtered by the ids just read, so RLS and the
  // subject are both already accounted for.
  const ids = concepts.map((concept) => concept.id);
  let states: StateRow[] = [];
  if (ids.length > 0) {
    const { data, error } = await supabase
      .from('concept_state')
      .select('concept_id, state, established, misconception, tested_at')
      .in('concept_id', ids);

    assertSchemaExposed(error, LEARN_SCHEMA);
    if (error) throw fail('Reading what you know', error);
    states = (data ?? []) as unknown as StateRow[];
  }

  const stateOf = new Map(states.map((state) => [state.concept_id, state]));

  return {
    concepts: concepts.map((row) => toConcept(row, stateOf.get(row.id))),
    edges: ((edgeRows ?? []) as unknown as { prerequisite_id: string; dependent_id: string }[]).map(
      (row) => ({ prerequisiteId: row.prerequisite_id, dependentId: row.dependent_id }),
    ),
  };
}

export async function loadGoals(
  supabase: LearnSupabaseClient,
  subjectId: string,
): Promise<Goal[]> {
  const { data, error } = await supabase
    .from('goals')
    .select('id, asked, concept_id, status')
    .eq('subject_id', subjectId)
    .order('created_at', { ascending: false });

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail('Reading your goals', error);

  return ((data ?? []) as unknown as {
    id: string;
    asked: string;
    concept_id: string | null;
    status: Goal['status'];
  }[]).map((row) => ({
    id: row.id,
    asked: row.asked,
    conceptId: row.concept_id,
    status: row.status,
  }));
}
