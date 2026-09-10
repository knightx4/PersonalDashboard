import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { LEARN_SCHEMA, type LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { addManualReading, createTrack } from '@/lib/learn/tracks/save';
import type { Concept } from '@/lib/learn/graph/model';

/**
 * A gap in the graph, put into the reading queue.
 *
 * The join between the two halves of the module, and it is deliberately small.
 * Nothing new is stored: a shaky concept becomes an ordinary reading in an
 * ordinary track, and everything the queue already does -- find a source, find
 * the passage, mark it read, write a note -- works on it because it is not a
 * special kind of row.
 *
 * What makes it worth doing is what the graph knows that a typed subject does
 * not. "Something about macroeconomics" is a search with no shape. "This
 * specific claim, which you believe this specific wrong thing about" is the
 * best input the sourcing half will ever get, and the misconception is the
 * part that tells a search what to look for rather than merely what about.
 */

function fail(action: string, error: { message: string }): Error {
  return new Error(`${action} failed: ${error.message}`);
}

/**
 * The question the sources get aimed at.
 *
 * The claim, and the misconception when there is one -- because "find me
 * something that explains why this is wrong" is a different search from "find
 * me something about this", and the second one hands back the introduction
 * somebody has already read.
 */
export function aimFor(concept: Concept): string {
  if (concept.misconception) {
    return `${concept.claim} What is currently believed instead: ${concept.misconception}`;
  }
  return concept.claim;
}

/**
 * Find the track this subject's gaps go in, or make it.
 *
 * One per subject, so a month of gap-reading lands in one place rather than
 * one track per concept. The question is rewritten each time to the claim
 * currently being chased, since that is what the next source gets aimed at.
 */
async function trackForSubject(
  supabase: LearnSupabaseClient,
  userId: string,
  subjectName: string,
  question: string,
): Promise<string> {
  const title = `${subjectName}: what you are missing`;

  const { data, error } = await supabase
    .from('tracks')
    .select('id')
    .eq('title', title)
    .maybeSingle();

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail('Looking for the track', error);

  if (data) {
    const id = (data as { id: string }).id;
    const { error: updateError } = await supabase
      .from('tracks')
      .update({ question })
      .eq('id', id);
    assertSchemaExposed(updateError, LEARN_SCHEMA);
    if (updateError) throw fail('Pointing the track at that claim', updateError);
    return id;
  }

  return createTrack(supabase, userId, { title, question });
}

/**
 * Put a concept in the queue, and hand back the reading to open.
 *
 * The reading carries the concept's name as its subject and the claim as its
 * reason, so the reading page reads as what it is -- a thing you are trying to
 * understand -- rather than as a row somebody generated.
 */
export async function queueConcept(
  supabase: LearnSupabaseClient,
  userId: string,
  input: { subjectName: string; concept: Concept },
): Promise<string> {
  const trackId = await trackForSubject(
    supabase,
    userId,
    input.subjectName,
    aimFor(input.concept),
  );

  return addManualReading(supabase, userId, {
    trackId,
    title: input.concept.name,
    why: input.concept.misconception
      ? `A gap worth closing: ${input.concept.misconception}`
      : `Shaky: ${input.concept.claim}`,
    // Which gap this was. The reading is still an ordinary row -- everything
    // the queue does works on it unchanged -- but it can now find its way back
    // to the graph, which is what lets the source search know where you stand
    // rather than only what you are missing.
    conceptId: input.concept.id,
  });
}
