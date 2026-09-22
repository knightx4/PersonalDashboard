'use server';

import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadReadyAndSettled, loadSubjects } from '@/lib/learn/graph/load';
import { pickOneToAsk, type NothingToAsk } from '@/lib/learn/graph/pick';
import type { SettledConcept } from '@/lib/learn/graph/recheck';
import { PROBE_MODEL, writeProbe } from '@/lib/learn/graph/probe';
import { answeredCount, nextMasteryCheck, probesFor, recordProbe } from '@/lib/learn/graph/session';
import { collectSpend, recordLearnSpend } from '@/lib/learn/spend';
import { answerQuestion, type AskState } from '../s/[id]/probe/actions';

/**
 * Practice Flow: a question, its answer, and then the next question, for as
 * long as you keep pressing Next.
 *
 * Asking is its own action because the claim is picked across every subject
 * rather than inside one. Answering is the subject session's action called
 * through a wrapper, so the concept state, what a right answer settles
 * underneath it, and a repeated wrong answer becoming a named misconception
 * are the same code in both places rather than two versions that drift.
 */

export type FlowState = AskState & {
  /** The subject the picked claim belongs to. What the link onwards points at. */
  subjectId?: string;
  subjectName?: string;
  /** Set instead of a question when there is nothing to ask about. */
  nothing?: NothingToAsk;
  /**
   * How the claim was settled, when this question is a re-check: by a question
   * you answered, or by your saying you already knew it. Unset for an ordinary
   * question, so it reads as a flag as well as naming which of the two.
   */
  recheck?: SettledConcept['established'];
};

/**
 * Asks, or answers, depending on which form was submitted.
 *
 * One action rather than two, because the flow alternates between them
 * indefinitely: with a separate state for each, whichever ran last would
 * have to be worked out on every render, and the question after an answer
 * would be read from the wrong one.
 */
// latency: pending
export async function flowStep(prev: FlowState, formData: FormData): Promise<FlowState> {
  return formData.get('intent') === 'answer'
    ? answerFlowQuestion(prev, formData)
    : askFlowQuestion();
}

/**
 * The next question. Nothing is carried over from the previous one: the pick
 * runs again, so an answer that just settled a claim moves it on.
 */
async function askFlowQuestion(): Promise<FlowState> {
  const user = await requireUser();

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: 'Asking a question needs ANTHROPIC_API_KEY to be set.' };

  const supabase = await createLearnClient();
  // Picked again here rather than carried from the page: what is ready can
  // have changed since the page was rendered, and the question should be
  // about what is ready now.
  const [subjects, rows, answered] = await Promise.all([
    loadSubjects(supabase),
    loadReadyAndSettled(supabase, 1),
    answeredCount(supabase),
  ]);

  const picked = pickOneToAsk({
    ready: rows.ready,
    settled: rows.settled,
    subjectCount: subjects.length,
    answered,
    now: new Date(),
  });
  if (picked.kind === 'nothing') return { nothing: picked.because };

  const { concept, subjectId, subjectName } = picked.row;
  const previous = await probesFor(supabase, concept.id);
  const check = nextMasteryCheck(
    concept.mastery,
    previous.map((probe) => probe.masteryCheck),
  );

  const spend = collectSpend();
  const result = await writeProbe({
    concept: concept.name,
    claim: concept.claim,
    check,
    otherChecks: concept.mastery.filter((other) => other !== check),
    asked: previous.map((probe) => probe.question),
    missedBefore: previous.some(
      (probe) => probe.chosenIndex !== null && probe.chosenIndex !== probe.correctIndex,
    ),
    anthropicApiKey: apiKey,
    onSpend: spend.sink,
  });
  await recordLearnSpend(user.id, 'write-probe', spend.reports);

  if (!result.ok) return { error: result.detail };

  const probeId = await recordProbe(supabase, user.id, {
    conceptId: concept.id,
    probe: result.probe,
    model: PROBE_MODEL,
  });

  return {
    probeId,
    conceptId: concept.id,
    conceptName: concept.name,
    subjectId,
    subjectName,
    recheck: picked.kind === 'recheck' ? picked.row.established : undefined,
    question: result.probe.question,
    options: result.probe.options,
  };
}

/**
 * The subject session's answer, with the subject kept on the state.
 *
 * `answerQuestion` returns the shape it was given, which has no subject name
 * on it, so the fields this screen needs for the link onwards are carried
 * across from the previous state.
 */
async function answerFlowQuestion(prev: FlowState, formData: FormData): Promise<FlowState> {
  return { ...prev, ...(await answerQuestion(prev, formData)) };
}
