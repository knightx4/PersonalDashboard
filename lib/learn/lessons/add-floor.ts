import 'server-only';

import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSpend, type SpendClient } from '@/lib/core/spend/record';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { proposeFloor } from '@/lib/learn/graph/floor';
import { loadGraph } from '@/lib/learn/graph/load';
import { isSettled } from '@/lib/learn/graph/model';
import { existingConcepts, saveChainInto } from '@/lib/learn/graph/save';
import type { LearnOperation } from '@/lib/learn/spend';

/**
 * Too hard on a lesson adds what its concept rests on (plan #970,
 * LEARN-LESSONS-SPEC "What a swipe does").
 *
 * The Learn now top-up calls this for each lesson rated too hard that has not
 * had it done. It is the step a probe takes when a wrong answer shows a
 * missing floor: one `proposeFloor` call names the one or two claims the
 * concept assumes, and they are saved under it with an edge to it. There is no
 * approval screen, as with a unit the top-up lays out, because nobody is
 * looking. The concept then has a prerequisite that is not known, so it stops
 * being ready, and the chooser puts what sits under it first
 * (`planTrack` in choose.ts).
 *
 * A lesson is taken once. `floor_at` is set before the call, so two runs at
 * once do not both add one, and it stays set whatever the call found, so
 * taking the rating back and giving it again adds nothing. Only a failed call
 * sets it back, for a later run to try again.
 *
 * It runs with the service role, so every read names the person and the track
 * is checked to be theirs before anything is written into it.
 */

const OPERATION: LearnOperation = 'add-lesson-floor';

/** A lesson rated too hard that has had nothing added under it yet. */
export type FloorDue = { cardId: string; subjectId: string; conceptId: string; name: string };

export type AddedFloor =
  | { outcome: 'added'; conceptIds: string[] }
  /** Nothing to add: the model found nothing missing, or the concept is known by now. */
  | { outcome: 'nothing-missing'; detail: string }
  /** Another run took this lesson first, or the rating was taken back. */
  | { outcome: 'taken' }
  | { outcome: 'failed'; detail: string };

/** The lessons rated too hard with nothing added under them yet, newest first. */
export async function loadFloorsDue(learn: LearnSupabaseClient, userId: string, limit: number): Promise<FloorDue[]> {
  const { data, error } = await learn
    .from('feed_cards')
    .select('id, subject_id, concept_id, idea_name')
    .eq('user_id', userId)
    .eq('reason', 'lesson')
    .eq('difficulty', 'too_hard')
    .is('floor_at', null)
    .not('subject_id', 'is', null)
    .not('concept_id', 'is', null)
    .order('written_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Reading the lessons rated too hard failed: ${error.message}`);
  return (
    (data ?? []) as { id: string; subject_id: string; concept_id: string; idea_name: string | null }[]
  ).map((row) => ({ cardId: row.id, subjectId: row.subject_id, conceptId: row.concept_id, name: row.idea_name ?? '' }));
}

/** Mark the lesson taken. False when another run took it first or the rating was taken back. */
async function claim(learn: LearnSupabaseClient, userId: string, cardId: string): Promise<boolean> {
  const { data, error } = await learn
    .from('feed_cards')
    .update({ floor_at: new Date().toISOString() })
    .eq('id', cardId)
    .eq('user_id', userId)
    .eq('difficulty', 'too_hard')
    .is('floor_at', null)
    .select('id');
  if (error) throw new Error(`Marking the lesson failed: ${error.message}`);
  return (data ?? []).length > 0;
}

async function release(learn: LearnSupabaseClient, userId: string, cardId: string): Promise<void> {
  const { error } = await learn
    .from('feed_cards')
    .update({ floor_at: null })
    .eq('id', cardId)
    .eq('user_id', userId);
  if (error) throw new Error(`Unmarking the lesson failed: ${error.message}`);
}

/**
 * Add what the lesson's concept rests on, under it. Never throws.
 *
 * `core` is a service-role client on the core schema, for the spend ledger;
 * the spend is recorded whether or not anything is saved.
 */
export async function addLessonFloor(
  learn: LearnSupabaseClient,
  core: SpendClient,
  userId: string,
  due: FloorDue,
  apiKey: string,
): Promise<AddedFloor> {
  try {
    const { data: subject, error: subjectError } = await learn
      .from('subjects')
      .select('id, name')
      .eq('id', due.subjectId)
      .eq('user_id', userId)
      .maybeSingle();
    if (subjectError) throw new Error(`Reading the track failed: ${subjectError.message}`);
    if (!subject) return { outcome: 'failed', detail: 'No track of this person has that id.' };
    const name = (subject as { name: string }).name;

    if (!(await claim(learn, userId, due.cardId))) return { outcome: 'taken' };

    const graph = await loadGraph(learn, due.subjectId, userId);
    const concept = graph.concepts.find((c) => c.id === due.conceptId);
    if (!concept) return { outcome: 'failed', detail: 'The lesson’s concept is no longer in its track.' };
    if (isSettled(concept)) {
      return { outcome: 'nothing-missing', detail: `${concept.name} is known by now.` };
    }

    // Scoped by the track, which was just checked to be this person's.
    const existing = await existingConcepts(learn, due.subjectId);

    const spend: SpendReport[] = [];
    const result = await proposeFloor({
      subject: name,
      concept: concept.name,
      claim: concept.claim,
      existing,
      anthropicApiKey: apiKey,
      onSpend: (report) => spend.push(report),
    });
    // Awaited, so the rows land before a background function is frozen.
    for (const report of spend) {
      await recordSpend(core, userId, { module: 'learn', operation: OPERATION, model: report.model, usage: report.usage });
    }
    if (!result.ok) {
      if (result.reason === 'nothing-missing') return { outcome: 'nothing-missing', detail: result.detail };
      // Nothing was written, so a later run can ask again.
      await release(learn, userId, due.cardId);
      return { outcome: 'failed', detail: result.detail };
    }

    const saved = await saveChainInto(learn, userId, due.subjectId, { ...result.chain, subject: name }, concept.name, {
      goal: false,
      origin: 'generated',
    });
    return { outcome: 'added', conceptIds: saved.conceptIds };
  } catch (error) {
    return { outcome: 'failed', detail: error instanceof Error ? error.message : 'Could not add what it rests on.' };
  }
}
