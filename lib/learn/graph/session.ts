import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { LEARN_SCHEMA, type LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import type { Probe } from '@/lib/learn/graph/probe-payload';
import { barPercent, weightFor } from '@/lib/learn/graph/probe-payload';
import { inferredFrom, type Concept, type Graph } from '@/lib/learn/graph/model';

/**
 * A probe session: what to ask about next, and what an answer settles.
 *
 * The evidence trail is kept in full rather than collapsed into a score. Every
 * question asked keeps its options as asked, the index chosen, and the weight
 * it earned, which is what makes "you have been wrong about this three times
 * in four months" answerable later and what any re-probing schedule would
 * read. A score would answer none of that and cannot be un-collapsed.
 *
 * All the state is here, in Postgres. Nothing carries a session in a
 * conversation, which is the difference between a session costing twenty cents
 * and costing ten dollars.
 */

export type ProbeRow = {
  id: string;
  conceptId: string;
  question: string;
  options: string[];
  correctIndex: number;
  reason: string;
  chosenIndex: number | null;
  weight: number;
};

function fail(action: string, error: { message: string }): Error {
  return new Error(`${action} failed: ${error.message}`);
}

/**
 * What this session has asked so far, and what it was worth.
 *
 * Read back rather than carried, so a session survives a closed tab: the bar
 * is a fact about the rows, not about a variable somebody is holding.
 */
export async function answeredWeight(
  supabase: LearnSupabaseClient,
  conceptIds: string[],
): Promise<number> {
  if (conceptIds.length === 0) return 0;

  const { data, error } = await supabase
    .from('probes')
    .select('weight')
    .in('concept_id', conceptIds)
    .not('answered_at', 'is', null);

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail('Reading what you have answered', error);

  return ((data ?? []) as { weight: number | string }[]).reduce(
    (total, row) => total + Number(row.weight),
    0,
  );
}

/** The bar, from the rows. */
export async function subjectBarPercent(
  supabase: LearnSupabaseClient,
  conceptIds: string[],
): Promise<number> {
  return barPercent(await answeredWeight(supabase, conceptIds));
}

/** Everything asked about one concept, newest first. */
export async function probesFor(
  supabase: LearnSupabaseClient,
  conceptId: string,
): Promise<ProbeRow[]> {
  const { data, error } = await supabase
    .from('probes')
    .select('id, concept_id, question, options, correct_index, reason, chosen_index, weight')
    .eq('concept_id', conceptId)
    .order('created_at', { ascending: false });

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail('Reading the questions asked', error);

  return ((data ?? []) as unknown as {
    id: string;
    concept_id: string;
    question: string;
    options: string[];
    correct_index: number;
    reason: string;
    chosen_index: number | null;
    weight: number | string;
  }[]).map((row) => ({
    id: row.id,
    conceptId: row.concept_id,
    question: row.question,
    options: row.options,
    correctIndex: row.correct_index,
    reason: row.reason,
    chosenIndex: row.chosen_index,
    weight: Number(row.weight),
  }));
}

/**
 * Which concept to ask about next.
 *
 * Unsettled first, and among those the ones with something already known about
 * them -- shaky and misconception -- before the ones nothing has been found
 * out about, because a claim you have already got wrong is where the next
 * question is worth most. A settled node is only revisited when there is
 * nothing else left, and then it is worth a fraction of the information.
 */
export function nextConcept(concepts: Concept[], askedCounts: Map<string, number>): Concept | null {
  const rank = (concept: Concept): number => {
    if (concept.state === 'misconception') return 0;
    if (concept.state === 'shaky') return 1;
    if (concept.state === 'unknown') return 2;
    return 3;
  };

  const sorted = [...concepts].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    // Then whichever has been asked about least, so a session spreads out
    // rather than circling one node.
    const byAsked = (askedCounts.get(a.id) ?? 0) - (askedCounts.get(b.id) ?? 0);
    if (byAsked !== 0) return byAsked;
    return a.name.localeCompare(b.name);
  });

  return sorted[0] ?? null;
}

/**
 * Mark a concept as carrying a named misconception.
 *
 * The state and the sentence are one fact -- the database refuses one without
 * the other -- because a misconception nobody can read is indistinguishable
 * from a gap, and the whole point of the state is that it is not one.
 */
export async function setMisconception(
  supabase: LearnSupabaseClient,
  userId: string,
  conceptId: string,
  misconception: string,
): Promise<void> {
  const { error } = await supabase.from('concept_state').upsert(
    {
      concept_id: conceptId,
      user_id: userId,
      state: 'misconception',
      established: 'tested',
      misconception,
      tested_at: new Date().toISOString(),
    },
    { onConflict: 'concept_id' },
  );

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail('Naming that misconception', error);
}

/** Write a question as asked, before it is answered. */
export async function recordProbe(
  supabase: LearnSupabaseClient,
  userId: string,
  input: { conceptId: string; probe: Probe; model: string },
): Promise<string> {
  const { data, error } = await supabase
    .from('probes')
    .insert({
      user_id: userId,
      concept_id: input.conceptId,
      question: input.probe.question,
      // As asked, verbatim. A stored index means nothing a month later if the
      // options were regenerated in the meantime.
      options: input.probe.options,
      correct_index: input.probe.correctIndex,
      reason: input.probe.reason,
      model: input.model,
    })
    .select('id')
    .single();

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error || !data) throw fail('Saving the question', error ?? { message: 'no row' });
  return (data as { id: string }).id;
}

export type AnswerOutcome = {
  correct: boolean;
  reason: string;
  weight: number;
  state: 'known' | 'shaky';
  /** How many nodes underneath were marked known by inference. */
  inferred: number;
};

/**
 * Mark what a correct answer implies, weakly.
 *
 * Written as `inferred` rather than `tested`, and only over nodes nobody has
 * answered about, which is what the rule in model.ts already worked out. The
 * upsert ignores conflicts rather than overwriting: a row that appeared
 * between the read and this write belongs to an answer, and an answer beats an
 * inference every time.
 */
async function markInferred(
  supabase: LearnSupabaseClient,
  userId: string,
  conceptIds: string[],
): Promise<number> {
  if (conceptIds.length === 0) return 0;

  const { error } = await supabase.from('concept_state').upsert(
    conceptIds.map((conceptId) => ({
      concept_id: conceptId,
      user_id: userId,
      state: 'known',
      established: 'inferred',
      misconception: null,
    })),
    { onConflict: 'concept_id', ignoreDuplicates: true },
  );

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail('Recording what that implied', error);
  return conceptIds.length;
}

/**
 * Record an answer, and move the concept with it.
 *
 * Right settles the node, wrong makes it shaky, and both record that they were
 * established by testing rather than inferred -- which is the distinction the
 * state and its basis are two columns for. A correct answer also settles what
 * the node rests on, weakly and never over an answer somebody gave.
 *
 * What a repeated wrong answer means -- the same option twice becoming a named
 * misconception -- is handled beside this rather than in it, because it costs a
 * model call and this must not.
 */
export async function recordAnswer(
  supabase: LearnSupabaseClient,
  userId: string,
  input: {
    probeId: string;
    conceptId: string;
    chosenIndex: number;
    wasSettled: boolean;
    /** The subject's graph, so a correct answer can settle what is under it. */
    graph?: Graph;
  },
): Promise<AnswerOutcome> {
  const { data, error } = await supabase
    .from('probes')
    .select('correct_index, reason, chosen_index')
    .eq('id', input.probeId)
    .maybeSingle();

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail('Reading the question', error);
  if (!data) throw new Error('That question is not there any more.');

  const probe = data as { correct_index: number; reason: string; chosen_index: number | null };
  const correct = probe.correct_index === input.chosenIndex;

  // Answering the same row twice earns nothing. The first answer is the one
  // that carried information; a second is a person clicking again.
  const weight =
    probe.chosen_index === null
      ? weightFor({ wasSettled: input.wasSettled, conclusive: true })
      : 0;

  const { error: answerError } = await supabase
    .from('probes')
    .update({
      chosen_index: input.chosenIndex,
      answered_at: new Date().toISOString(),
      weight,
    })
    .eq('id', input.probeId);

  assertSchemaExposed(answerError, LEARN_SCHEMA);
  if (answerError) throw fail('Saving the answer', answerError);

  const state = correct ? 'known' : 'shaky';
  const { error: stateError } = await supabase.from('concept_state').upsert(
    {
      concept_id: input.conceptId,
      user_id: userId,
      state,
      established: 'tested',
      // Cleared on any tested answer: a misconception is named by the next
      // slice from a repeated wrong option, and carrying an old one through a
      // correct answer would be the screen saying something untrue.
      misconception: null,
      tested_at: new Date().toISOString(),
    },
    { onConflict: 'concept_id' },
  );

  assertSchemaExposed(stateError, LEARN_SCHEMA);
  if (stateError) throw fail('Recording what that settled', stateError);

  // Growth trigger 3: answering correctly about a node says the things it
  // rests on are probably in place. Weakly, and never over an answer somebody
  // actually gave -- inferredFrom already refuses those.
  const inferred =
    correct && input.graph
      ? await markInferred(supabase, userId, inferredFrom(input.graph, input.conceptId))
      : 0;

  return { correct, reason: probe.reason, weight, state, inferred };
}
