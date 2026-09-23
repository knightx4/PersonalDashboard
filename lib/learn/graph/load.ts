import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { LEARN_SCHEMA, type LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import type {
  Concept,
  ConceptKind,
  Graph,
  KnowledgeState,
  StateBasis,
} from '@/lib/learn/graph/model';
import {
  rankByLastChecked,
  settledInSubject,
  type SettledConcept,
} from '@/lib/learn/graph/recheck';
import {
  rankReady,
  readyInSubject,
  READY_LIMIT,
  type ReadyConcept,
} from '@/lib/learn/graph/ready';

/**
 * Reading a subject's graph.
 *
 * Every query goes through the session client, so RLS decides what comes back
 * and nothing here filters by user id. Four plain reads rather than embedded
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
  if (error) throw fail('Reading your tracks', error);

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
  if (error) throw fail('Reading that track', error);
  if (!data) return null;

  const subject = data as { id: string; name: string; note: string | null; created_at: string };
  return {
    id: subject.id,
    name: subject.name,
    note: subject.note,
    createdAt: subject.created_at,
  };
}

/**
 * Which subject a concept belongs to.
 *
 * One column, because the caller already has the concept id and wants the
 * graph around it. Null when the concept has been deleted, which is a normal
 * thing for a reading queued months ago to run into.
 */
export async function subjectIdOfConcept(
  supabase: LearnSupabaseClient,
  conceptId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('concepts')
    .select('subject_id')
    .eq('id', conceptId)
    .maybeSingle();

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail('Reading that concept', error);
  return data ? (data as { subject_id: string }).subject_id : null;
}

type ConceptRow = {
  id: string;
  name: string;
  claim: string;
  claim_original: string | null;
  claim_rewritten_at: string | null;
  basis: string;
  kind: ConceptKind | null;
  mastery: unknown;
  catalogue_searched_at: string | null;
};

/**
 * The checks, as a list the screens can map over.
 *
 * The column is a jsonb array of strings and the database refuses anything
 * else, but it is also nullable -- a concept written before the checks existed,
 * or one the model wrote none for, has nothing there. Both arrive here as an
 * empty list, because "no checks" is a thing the pages say rather than a case
 * they crash on.
 */
function masteryOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((check): check is string => typeof check === 'string');
}

type StateRow = {
  concept_id: string;
  state: KnowledgeState;
  established: StateBasis;
  misconception: string | null;
  tested_at: string | null;
  declared_at: string | null;
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
    claimOriginal: row.claim_original ?? null,
    claimRewrittenAt: row.claim_rewritten_at ?? null,
    basis: row.basis,
    kind: row.kind,
    mastery: masteryOf(row.mastery),
    state: state?.state ?? 'unknown',
    established: state?.established ?? 'inferred',
    misconception: state?.misconception ?? null,
    testedAt: state?.tested_at ?? null,
    declaredAt: state?.declared_at ?? null,
    catalogueSearchedAt: row.catalogue_searched_at ?? null,
  };
}

/**
 * One concept, with what is known about it.
 *
 * For the places that hold a concept id and want the claim rather than the
 * whole graph around it -- opening a reading queued from a gap, which needs to
 * know what that reading is for and nothing else. Null when the concept has
 * been deleted since, which is a normal thing for a reading queued months ago
 * to run into.
 */
export async function loadConcept(
  supabase: LearnSupabaseClient,
  conceptId: string,
): Promise<Concept | null> {
  const { data, error } = await supabase
    .from('concepts')
    .select('id, name, claim, basis, kind, mastery, catalogue_searched_at')
    .eq('id', conceptId)
    .maybeSingle();

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail('Reading that concept', error);
  if (!data) return null;

  const { data: stateData, error: stateError } = await supabase
    .from('concept_state')
    .select('concept_id, state, established, misconception, tested_at, declared_at')
    .eq('concept_id', conceptId)
    .maybeSingle();

  assertSchemaExposed(stateError, LEARN_SCHEMA);
  if (stateError) throw fail('Reading what you know', stateError);

  return toConcept(
    data as unknown as ConceptRow,
    (stateData ?? undefined) as StateRow | undefined,
  );
}

export async function loadGraph(
  supabase: LearnSupabaseClient,
  subjectId: string,
): Promise<Graph> {
  const [
    { data: conceptRows, error: conceptError },
    { data: edgeRows, error: edgeError },
    { data: mentionRows, error: mentionError },
  ] = await Promise.all([
    supabase
      .from('concepts')
      .select(
        'id, name, claim, claim_original, claim_rewritten_at, basis, kind, mastery, ' +
          'catalogue_searched_at',
      )
      .eq('subject_id', subjectId)
      .order('name'),
    supabase
      .from('concept_edges')
      .select('prerequisite_id, dependent_id')
      .eq('subject_id', subjectId),
    supabase
      .from('concept_mentions')
      .select('source_id, target_id, basis')
      .eq('subject_id', subjectId),
  ]);

  assertSchemaExposed(conceptError ?? edgeError ?? mentionError, LEARN_SCHEMA);
  if (conceptError) throw fail('Reading the concepts', conceptError);
  if (edgeError) throw fail('Reading the prerequisites', edgeError);
  if (mentionError) throw fail('Reading what refers to what', mentionError);

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
      .select('concept_id, state, established, misconception, tested_at, declared_at')
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
    mentions: ((mentionRows ?? []) as unknown as {
      source_id: string;
      target_id: string;
      basis: string;
    }[]).map((row) => ({
      sourceId: row.source_id,
      targetId: row.target_id,
      basis: row.basis,
    })),
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

/**
 * Everything you could start on and everything you have settled, in every
 * subject, or in the one named by `onlySubjectId`.
 *
 * One read per subject, the same four queries `/learn/know` already runs in a
 * loop, and no model call anywhere in it. A goal counts as one you named
 * unless you abandoned it, which is the rule the subject page uses to decide
 * what to draw a chain for. Both lists come out of the same walk because
 * Practice Flow needs both to pick one claim, and walking twice would be the
 * same graphs read twice.
 */
async function everywhere(
  supabase: LearnSupabaseClient,
  onlySubjectId: string | null,
): Promise<{
  ready: ReadyConcept[];
  settled: SettledConcept[];
}> {
  const all = await loadSubjects(supabase);
  const subjects = onlySubjectId ? all.filter((subject) => subject.id === onlySubjectId) : all;

  const perSubject = await Promise.all(
    subjects.map(async (subject) => {
      const [graph, goals] = await Promise.all([
        loadGraph(supabase, subject.id),
        loadGoals(supabase, subject.id),
      ]);

      const goalConceptIds = goals
        .filter((goal) => goal.status !== 'abandoned' && goal.conceptId !== null)
        .map((goal) => goal.conceptId!);

      return {
        ready: readyInSubject(graph, subject, goalConceptIds),
        settled: settledInSubject(graph, subject),
      };
    }),
  );

  return {
    ready: perSubject.flatMap((subject) => subject.ready),
    settled: perSubject.flatMap((subject) => subject.settled),
  };
}

/**
 * What Practice Flow's questions are picked from.
 *
 * The ranked few that could be started next, and the settled claims you have
 * gone longest without being asked about, oldest first. One walk of the
 * subjects for both, so the page and the action each read the graphs once.
 *
 * `onlySubjectId` is a flow focused on one track (plan #779). It narrows the
 * walk before the ranking, so `limit` counts rows in that track alone rather
 * than the top few everywhere with the others filtered out afterwards.
 */
export async function loadReadyAndSettled(
  supabase: LearnSupabaseClient,
  limit: number = READY_LIMIT,
  onlySubjectId: string | null = null,
): Promise<{ ready: ReadyConcept[]; settled: SettledConcept[] }> {
  const { ready, settled } = await everywhere(supabase, onlySubjectId);
  return { ready: rankReady(ready, limit), settled: rankByLastChecked(settled) };
}
