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
 * Find the track this subject's gaps go in, or make it.
 *
 * One per subject, so a month of gap-reading lands in one place rather than
 * one track per concept. Exported because queuing a piece of catalogue
 * material for a claim goes in the same place: it was found for a gap in this
 * subject, and a second track holding the same month of reading would split
 * the one queue in two. The question is written once, when the track is made,
 * and describes the track rather than any one gap in it: a track that holds
 * twenty claims cannot be about the twentieth. Each reading carries its own
 * claim, which is read off its concept when something needs it.
 */
export async function trackForSubject(
  supabase: LearnSupabaseClient,
  userId: string,
  subjectName: string,
): Promise<string> {
  const title = `${subjectName}: what you are missing`;

  const { data, error } = await supabase
    .from('tracks')
    .select('id')
    .eq('title', title)
    .maybeSingle();

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail('Looking for the reading list', error);

  if (data) return (data as { id: string }).id;

  return createTrack(supabase, userId, {
    title,
    question: `What would help with the ideas in ${subjectName} you are still getting there on?`,
  });
}

/**
 * The reading already queued for this gap, when there is one you have not
 * finished with.
 *
 * `queued` and `reading` count; `read` and `abandoned` do not. Wanting to read
 * more about a claim you have read about once is ordinary, and so is coming
 * back to a claim you gave up on -- both of those are a new reading. What is
 * not ordinary is pressing the button twice and ending up with the row twice.
 */
async function unfinishedReadingFor(
  supabase: LearnSupabaseClient,
  conceptId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('readings')
    .select('id')
    .eq('concept_id', conceptId)
    .in('status', ['queued', 'reading'])
    .order('created_at')
    .limit(1)
    .maybeSingle();

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail('Looking for what you already queued', error);
  return data ? (data as { id: string }).id : null;
}

/**
 * Put a concept in the queue, and hand back the reading to open.
 *
 * Pressing the button on a gap you already queued hands back the reading you
 * already have rather than a second copy of it, so the queue holds one row per
 * gap you are working on.
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
  const existing = await unfinishedReadingFor(supabase, input.concept.id);
  if (existing) return existing;

  const trackId = await trackForSubject(supabase, userId, input.subjectName);

  return addManualReading(supabase, userId, {
    trackId,
    title: input.concept.name,
    why: input.concept.misconception
      ? `A gap worth closing: ${input.concept.misconception}`
      : `Getting there: ${input.concept.claim}`,
    // Which gap this was. The reading is still an ordinary row -- everything
    // the queue does works on it unchanged -- but it can now find its way back
    // to the graph, which is what lets the source search know where you stand
    // rather than only what you are missing.
    conceptId: input.concept.id,
  });
}
