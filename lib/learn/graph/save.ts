import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { LEARN_SCHEMA, type LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import type { ProposedChain } from '@/lib/learn/graph/chain-payload';

/**
 * Writing a chain somebody approved.
 *
 * Nothing in this file runs before approval. That is the same rule the import
 * path follows and it matters more here: a reading list you did not want is a
 * few unticked rows, and a graph you did not want is the thing every later
 * question is asked against. A wrong graph is worse than no graph.
 *
 * Every write goes through the session client, so RLS decides what lands, and
 * the user id is passed explicitly on insert because the policy compares it to
 * auth.uid(). Not a transaction, for the reason lib/learn/tracks/save.ts gives:
 * PostgREST cannot open one, and the alternative -- the whole chain as json
 * into a security definer function -- buys atomicity by moving the module's
 * rules into SQL. The order below is chosen so that a failure part way through
 * leaves something legible: the subject, then its concepts, then the edges
 * between them, then what refers to what, and the goal last, so a goal never
 * points at a node that is not there.
 */

/** The `learn.concept_origin` values a chain write can set. */
export type ConceptOrigin = 'generated' | 'briefing';

export type SavedChain = {
  subjectId: string;
  /** Null when the chain was a floor rather than something new to aim at. */
  goalId: string | null;
  conceptsAdded: number;
  edgesAdded: number;
  mentionsAdded: number;
  /**
   * The ids of the nodes this write actually inserted, in the order they were
   * proposed. Only the new ones: a node the chain matched against the subject
   * was already there and is not this write's to say anything about.
   */
  conceptIds: string[];
};

function fail(action: string, error: { message: string }): Error {
  return new Error(`${action} failed: ${error.message}`);
}

/**
 * Find the subject by name, or make it.
 *
 * Case-insensitive, matching the unique index: `economics` and `Economics` are
 * one subject, and ending up with two half-graphs of the same field is the
 * failure the spec warns about specifically.
 */
export async function findOrCreateSubject(
  supabase: LearnSupabaseClient,
  userId: string,
  name: string,
): Promise<{ id: string; created: boolean }> {
  const { data, error } = await supabase
    .from('subjects')
    .select('id, name')
    .ilike('name', name)
    .maybeSingle();

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail('Looking up the subject', error);
  if (data) return { id: (data as { id: string }).id, created: false };

  const { data: created, error: createError } = await supabase
    .from('subjects')
    .insert({ user_id: userId, name })
    .select('id')
    .single();

  assertSchemaExposed(createError, LEARN_SCHEMA);
  if (createError || !created) {
    throw fail('Creating the subject', createError ?? { message: 'no row' });
  }
  return { id: (created as { id: string }).id, created: true };
}

/**
 * Write an approved chain into a subject.
 *
 * Concepts already in the subject are not written again -- the chain carries
 * the id each one matched, which is what the dedupe in chain-payload.ts was
 * for. Their edges still are: joining what you already knew to what you just
 * added is most of the value of asking for a second goal in the same subject.
 */
export async function saveChain(
  supabase: LearnSupabaseClient,
  userId: string,
  chain: ProposedChain,
  /** What they actually typed, kept as the goal rather than the tidy node name. */
  asked: string,
  /**
   * A floor added under a claim somebody missed is a level appearing in a
   * subject they are already working on, not a new thing to aim at, so it
   * writes no goal -- the goals already there simply grow a rung.
   *
   * `origin` is what each concept says about where it came from, and it is
   * worth setting: on the day a claim turns out to be wrong, `generated` points
   * at a model that laid out a chain and `briefing` points at a document
   * somebody handed you.
   */
  options: { goal?: boolean; origin?: ConceptOrigin } = {},
): Promise<SavedChain> {
  const { id: subjectId } = await findOrCreateSubject(supabase, userId, chain.subject);

  const idByName = new Map<string, string>();
  for (const node of chain.nodes) {
    if (node.existingId) idByName.set(node.name.toLowerCase(), node.existingId);
  }

  const conceptIds: string[] = [];
  const fresh = chain.nodes.filter((node) => !node.existingId);
  if (fresh.length > 0) {
    const { data, error } = await supabase
      .from('concepts')
      .insert(
        fresh.map((node) => ({
          user_id: userId,
          subject_id: subjectId,
          name: node.name,
          claim: node.claim,
          basis: node.basis,
          // Null rather than an empty array: the column takes two to four
          // checks or nothing, and a node whose checks the model never wrote
          // is saved as it is rather than refused.
          mastery: node.mastery.length > 0 ? node.mastery : null,
          // Null when the model said nothing usable. The column takes the two
          // values or nothing, and nothing is what an unjudged concept is.
          kind: node.kind,
          origin: options.origin ?? 'generated',
        })),
      )
      .select('id, name');

    assertSchemaExposed(error, LEARN_SCHEMA);
    if (error || !data) throw fail('Saving the concepts', error ?? { message: 'no rows' });

    for (const row of data as { id: string; name: string }[]) {
      idByName.set(row.name.toLowerCase(), row.id);
      conceptIds.push(row.id);
    }
  }

  const edges = chain.edges
    .map((edge) => ({
      user_id: userId,
      subject_id: subjectId,
      prerequisite_id: idByName.get(edge.prerequisite.toLowerCase()),
      dependent_id: idByName.get(edge.dependent.toLowerCase()),
      basis: edge.basis,
    }))
    // An edge whose end did not survive the insert is dropped rather than
    // guessed at. It cannot happen from a normalised chain, and if it ever
    // does, a missing edge is recoverable and a wrong one is not.
    .filter((edge) => edge.prerequisite_id && edge.dependent_id);

  if (edges.length > 0) {
    // The database refuses an edge that would close a cycle, and refuses a
    // duplicate pair. Both are already screened out upstream; this insert is
    // where the guarantee actually lives.
    const { error } = await supabase.from('concept_edges').insert(edges);
    assertSchemaExposed(error, LEARN_SCHEMA);
    if (error) throw fail('Saving the prerequisites', error);
  }

  // After the edges, for the same reason the goal comes last: a mention never
  // points at a node that is not there. Unlike an edge it is allowed to run in
  // both directions between a pair, so there is no cycle check to fail -- the
  // only thing the database refuses here is the same direction twice.
  const mentions = chain.mentions
    .map((mention) => ({
      user_id: userId,
      subject_id: subjectId,
      source_id: idByName.get(mention.source.toLowerCase()),
      target_id: idByName.get(mention.target.toLowerCase()),
      basis: mention.basis,
    }))
    .filter((mention) => mention.source_id && mention.target_id);

  if (mentions.length > 0) {
    // The pair may already be there: a second briefing about the same ground
    // reaches the same two claims and says the same thing about them. The one
    // already stored wins, because its sentence was written while that claim
    // was being read. A duplicate is not a reason to refuse the whole import.
    const { error } = await supabase
      .from('concept_mentions')
      .upsert(mentions, { onConflict: 'source_id,target_id', ignoreDuplicates: true });
    assertSchemaExposed(error, LEARN_SCHEMA);
    if (error) throw fail('Saving what refers to what', error);
  }

  if (options.goal === false) {
    return {
      subjectId,
      goalId: null,
      conceptsAdded: fresh.length,
      edgesAdded: edges.length,
      mentionsAdded: mentions.length,
      conceptIds,
    };
  }

  const goalConceptId = idByName.get(chain.goalConcept.toLowerCase()) ?? null;
  const { data: goal, error: goalError } = await supabase
    .from('goals')
    .insert({
      user_id: userId,
      subject_id: subjectId,
      asked,
      concept_id: goalConceptId,
      // Approved by the person who is looking at it, which is what makes it
      // active rather than proposed.
      status: 'active',
    })
    .select('id')
    .single();

  assertSchemaExposed(goalError, LEARN_SCHEMA);
  if (goalError || !goal) throw fail('Saving the goal', goalError ?? { message: 'no row' });

  return {
    subjectId,
    goalId: (goal as { id: string }).id,
    conceptsAdded: fresh.length,
    edgesAdded: edges.length,
    mentionsAdded: mentions.length,
    conceptIds,
  };
}

/**
 * Mark concepts as known because somebody said so.
 *
 * The one write in this module that sets a state without a probe behind it,
 * which is why `established` says `declared` and the subject screen renders
 * that as "you said so". A node that got here this way is settled on your word
 * and nothing else, and every screen that shows the state is expected to keep
 * saying so rather than quietly promoting it to the same footing as a tested
 * one.
 *
 * Only ever handed ids this write just inserted. A concept already in the
 * graph already has a state, arrived at some way -- possibly a probe that said
 * shaky -- and overwriting that from a paste would destroy the only evidence
 * in the module that was actually collected rather than asserted.
 */
export async function declareKnown(
  supabase: LearnSupabaseClient,
  userId: string,
  conceptIds: string[],
): Promise<void> {
  if (conceptIds.length === 0) return;

  const { error } = await supabase.from('concept_state').upsert(
    conceptIds.map((conceptId) => ({
      concept_id: conceptId,
      user_id: userId,
      state: 'known',
      established: 'declared',
      // Not tested, so not dated. `tested_at` is what "not checked since
      // March" is read off, and a declaration has never been checked at all.
      tested_at: null,
    })),
    { onConflict: 'concept_id' },
  );

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail('Marking those as known', error);
}

/** The names a subject already holds, which is all the generator needs of it. */
export async function existingConcepts(
  supabase: LearnSupabaseClient,
  subjectId: string,
): Promise<{ id: string; name: string }[]> {
  const { data, error } = await supabase
    .from('concepts')
    .select('id, name')
    .eq('subject_id', subjectId)
    .order('name');

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail('Reading the subject', error);
  return (data ?? []) as { id: string; name: string }[];
}
