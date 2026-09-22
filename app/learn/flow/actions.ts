'use server';

import { after } from 'next/server';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { fillQueue, nextQuestion } from '@/lib/learn/flow/ahead';
import { trackMove } from '@/lib/learn/flow/track';
import { loadGraph } from '@/lib/learn/graph/load';
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

  const state =
    formData.get('intent') === 'answer'
      ? await answerFlowQuestion(prev, formData)
      : toFlowState(await nextQuestion(supabase, user.id, { resume: false }));

  after(() => fillQueue(supabase, user.id));
  return state;
}

/**
 * Tops the queue up without asking anything. Called once when the page opens,
 * so a queue that ran down while you were away is full again by the time you
 * have answered the question already on the screen.
 */
export async function fillFlowQueue(): Promise<void> {
  const user = await requireUser();
  const supabase = await createLearnClient();
  after(() => fillQueue(supabase, user.id));
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
 */
async function answerFlowQuestion(prev: FlowState, formData: FormData): Promise<FlowState> {
  const supabase = await createLearnClient();
  const subjectId = prev.subjectId;
  const before = subjectId ? await loadGraph(supabase, subjectId).catch(() => null) : null;

  const answered: FlowState = { ...prev, track: undefined, ...(await answerQuestion(prev, formData)) };
  if (!before || !subjectId || !answered.answered || answered.error) return answered;

  const after = await loadGraph(supabase, subjectId).catch(() => null);
  return after ? { ...answered, track: trackMove(before, after) } : answered;
}
