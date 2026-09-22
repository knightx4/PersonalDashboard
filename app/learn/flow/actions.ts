'use server';

import { after } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { fillQueue, nextQuestion } from '@/lib/learn/flow/ahead';
import { trackMove } from '@/lib/learn/flow/track';
import { loadGraph, loadReadingToOffer } from '@/lib/learn/graph/load';
import { recordOutcome } from '@/lib/learn/next/record';
import { answerQuestion } from '../s/[id]/probe/actions';
import { toFlowState, type FlowState } from './state';

/**
 * Practice Flow: a question, its answer, and then the next question, for as
 * long as you keep pressing Next.
 *
 * Asking is its own action because the claim is picked across every subject
 * rather than inside one. Answering is the subject session's action called
 * through a wrapper, so the concept state, what a right answer settles
 * underneath it, and a repeated wrong answer becoming a named misconception
 * are the same code in both places rather than two versions that drift.
 *
 * The questions themselves are mostly written before they are asked for
 * (`lib/learn/flow/ahead.ts`): Next takes one off a queue, and the queue is
 * topped up from `after()` once the response has gone.
 */

export type { FlowState };

const TrackId = z.string().uuid();

/**
 * The track a focused flow asks about, from the form's hidden `track` field,
 * or null for asking across all of them (plan #779). Not trusted for
 * ownership: it only narrows which of your own subjects are read, and a
 * subject that is not yours reads as none.
 */
function trackFrom(formData: FormData): string | null {
  const track = TrackId.safeParse(formData.get('track'));
  return track.success ? track.data : null;
}

/**
 * Asks, or answers, depending on which form was submitted.
 *
 * One action rather than two, because the flow alternates between them
 * indefinitely: with a separate state for each, whichever ran last would
 * have to be worked out on every render, and the question after an answer
 * would be read from the wrong one.
 *
 * Either way the queue of questions written ahead is topped up afterwards.
 * After an answer is when it matters: the claim just answered may have moved,
 * and the picks after it are worked out from where things stand now.
 */
// latency: pending
export async function flowStep(prev: FlowState, formData: FormData): Promise<FlowState> {
  const user = await requireUser();
  const supabase = await createLearnClient();

  const track = trackFrom(formData);

  const state =
    formData.get('intent') === 'answer'
      ? await answerFlowQuestion(prev, formData)
      : toFlowState(await nextQuestion(supabase, user.id, { resume: false, track }));

  after(() => fillQueue(supabase, user.id, track));
  return state;
}

/**
 * Tops the queue up without asking anything. Called once when the page opens,
 * so a queue that ran down while you were away is full again by the time you
 * have answered the question already on the screen.
 */
export async function fillFlowQueue(track: string | null): Promise<void> {
  const user = await requireUser();
  const supabase = await createLearnClient();
  const focus = TrackId.safeParse(track);
  after(() => fillQueue(supabase, user.id, focus.success ? focus.data : null));
}

/**
 * The subject session's answer, with the subject kept on the state and the
 * track's move worked out around it.
 *
 * `answerQuestion` returns the shape it was given, which has no subject name
 * on it, so the fields this screen needs for the link onwards are carried
 * across from the previous state.
 *
 * The graph is read before the answer and again after it, because what an
 * answer settles is decided inside `answerQuestion` (the claim itself, and by
 * inference what it rests on) and the counts on either side are the only
 * record of it. Failing to read either loses the track line, not the answer.
 * The reading offered under the answer is looked up alongside the second read.
 */
async function answerFlowQuestion(prev: FlowState, formData: FormData): Promise<FlowState> {
  const supabase = await createLearnClient();
  const subjectId = prev.subjectId;
  const before = subjectId ? await loadGraph(supabase, subjectId).catch(() => null) : null;

  const answered: FlowState = {
    ...prev,
    track: undefined,
    reading: undefined,
    ...(await answerQuestion(prev, formData)),
  };
  if (!answered.answered || answered.error) return answered;

  const [after, reading] = await Promise.all([
    before && subjectId ? loadGraph(supabase, subjectId).catch(() => null) : null,
    readingFor(supabase, prev.conceptId ?? null),
  ]);
  return {
    ...answered,
    ...(before && after ? { track: trackMove(before, after) } : {}),
    ...(reading ? { reading } : {}),
  };
}

/**
 * The queued reading to offer under an answer, preferring one about the claim
 * just answered. A failure to read the queue loses the offer, not the answer.
 */
async function readingFor(
  supabase: LearnSupabaseClient,
  conceptId: string | null,
): Promise<FlowState['reading'] | null> {
  const row = await loadReadingToOffer(supabase, conceptId).catch(() => null);
  return row ? { id: row.readingId, title: row.title, reason: row.reason } : null;
}

const ReadingId = z.string().uuid();

/**
 * Not now, on a reading the flow offered.
 *
 * The same outcome Learn next's Not now wrote, so the reading stays out of
 * the offer for the few weeks `lib/learn/next/rank.ts` holds it. Nothing is
 * revalidated: the panel hides the offer itself, and refreshing /learn would
 * run the page again and take a new question off the queue.
 *
 * The id comes from the form and is not trusted for ownership. The insert goes
 * through the session client, so RLS decides whether there is a reading there.
 */
// latency: optimistic
export async function pushReadingAside(formData: FormData): Promise<void> {
  const user = await requireUser();
  const readingId = ReadingId.safeParse(formData.get('readingId'));
  if (!readingId.success) return;

  const supabase = await createLearnClient();
  await recordOutcome(supabase, user.id, {
    kind: 'reading',
    readingId: readingId.data,
    outcome: 'not_now',
  });
}
