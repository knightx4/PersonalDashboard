import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { placeTrackAfterResponse, type TrackTheme } from '@/lib/learn/areas/place-track';
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

/** A line saying what a track covers: what was asked for, and its first few ideas. */
export function trackContext(asked: string, chain: ProposedChain): string {
  const ideas = chain.nodes.slice(0, 8).map((node) => node.name);
  return [`aimed at: ${asked}`, ideas.length > 0 ? `ideas: ${ideas.join('; ')}` : '']
    .filter(Boolean)
    .join('. ');
}

function fail(action: string, error: { message: string }): Error {
  return new Error(`${action} failed: ${error.message}`);
}

/**
 * Find the subject by name, or make it.
 *
 * Case-insensitive, matching the unique index: `economics` and `Economics` are
 * one subject, and ending up with two half-graphs of the same field is the
 * failure the spec warns about specifically.
 *
 * `placed` says whether the subject has a placement in the areas yet. A new
 * one never has, and an old one lacks it only when placing it failed.
 */
export async function findOrCreateSubject(
  supabase: LearnSupabaseClient,
  userId: string,
  name: string,
): Promise<{ id: string; created: boolean; placed: boolean }> {
  const { data, error } = await supabase
    .from('subjects')
    .select('id, name, placed_at, survey')
    .ilike('name', name)
    .maybeSingle();

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail('Looking up the track', error);
  if (data) {
    const found = data as { id: string; placed_at?: string | null; survey?: boolean };
    // A hidden subject holding survey questions about this theme (plan #838)
    // becomes the track, so the ideas already tested there are its start.
    if (found.survey) {
      const { error: takeError } = await supabase
        .from('subjects')
        .update({ survey: false })
        .eq('id', found.id);
      if (takeError) throw fail('Turning the survey subject into a track', takeError);
    }
    return { id: found.id, created: false, placed: Boolean(found.placed_at) };
  }

  const { data: created, error: createError } = await supabase
    .from('subjects')
    .insert({ user_id: userId, name })
    .select('id')
    .single();

  assertSchemaExposed(createError, LEARN_SCHEMA);
  if (createError || !created) {
    throw fail('Creating the track', createError ?? { message: 'no row' });
  }
  return { id: (created as { id: string }).id, created: true, placed: false };
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
   *
   * `theme` is the vault theme a track was started from, when it was. The
   * track then takes that theme's placement in the areas rather than asking
   * the model for one.
   *
   * `subjectId` writes into a track already known to be this person's,
   * skipping the lookup by name and the placement. It is how a write through
   * the service role stays scoped: the name lookup relies on RLS to see only
   * the person's own tracks, and under the service role it would match a
   * track of the same name belonging to anybody (lib/learn/lessons/lay-out-unit.ts).
   */
  options: {
    goal?: boolean;
    origin?: ConceptOrigin;
    theme?: TrackTheme;
    unitId?: string | null;
    subjectId?: string;
  } = {},
): Promise<SavedChain> {
  const { id: subjectId, placed } = options.subjectId
    ? { id: options.subjectId, placed: true }
    : await findOrCreateSubject(supabase, userId, chain.subject);

  // Placed once the response has gone, and never allowed to fail the write: a
  // track with no field is still a track, and the next chain written into it
  // tries again (docs/LEARN-AREAS-SPEC.md, "Placement").
  if (!placed) {
    const track = { id: subjectId, name: chain.subject, context: trackContext(asked, chain) };
    placeTrackAfterResponse(supabase, userId, track, options.theme);
  }

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
      // The curriculum unit it was opened from, when it was.
      unit_id: options.unitId ?? null,
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
 * `declareConceptKnown` below does overwrite, and says why that is a different
 * case.
 */
export async function declareKnown(
  supabase: LearnSupabaseClient,
  userId: string,
  conceptIds: string[],
): Promise<void> {
  if (conceptIds.length === 0) return;

  const declaredAt = new Date().toISOString();
  const { error } = await supabase.from('concept_state').upsert(
    conceptIds.map((conceptId) => ({
      concept_id: conceptId,
      user_id: userId,
      state: 'known',
      established: 'declared',
      // Not tested, so no `tested_at`. That column is what "not checked since
      // March" is read off, and a declaration has never been checked at all.
      // The day you declared it goes in its own column, which is what lets a
      // claim settled on your word come back for a question later.
      tested_at: null,
      declared_at: declaredAt,
    })),
    { onConflict: 'concept_id' },
  );

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail('Marking those as known', error);
}

/**
 * Mark one concept known because you said so about the case in front of you.
 *
 * The same row `declareKnown` writes, with one difference: this one overwrites
 * whatever state is already there. That is wanted here. The case was offered
 * about this one concept, on screen, and the answer given to it was that you
 * are already sure -- so a `recognised` left by an earlier picked answer is
 * exactly what the wave-through is replacing. It stays unwanted on the paste
 * path, where the ids arrive as a list nobody read one at a time and a `shaky`
 * a probe collected would be overwritten without being shown to anybody.
 *
 * `misconception` is cleared by the same write, as `settleConcept` clears it:
 * the column is tied to the state by a check constraint, so a concept carrying
 * a named misconception cannot move to `known` while the sentence is still on
 * the row.
 */
export async function declareConceptKnown(
  supabase: LearnSupabaseClient,
  userId: string,
  conceptId: string,
): Promise<void> {
  const { error } = await supabase.from('concept_state').upsert(
    {
      concept_id: conceptId,
      user_id: userId,
      state: 'known',
      established: 'declared',
      misconception: null,
      // Nothing was answered, so there is no tested date to write. What the
      // row does carry is the day it was waved through, which is what the
      // re-check schedule reads when a claim has no `tested_at`.
      tested_at: null,
      declared_at: new Date().toISOString(),
    },
    { onConflict: 'concept_id' },
  );

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail('Marking that as known', error);
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
  if (error) throw fail('Reading the track', error);
  return (data ?? []) as { id: string; name: string }[];
}
