'use server';

import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadReadyToLearn, loadSubjects } from '@/lib/learn/graph/load';
import { pickOneToAsk, type NothingToAsk } from '@/lib/learn/graph/pick';
import { PROBE_MODEL, writeProbe } from '@/lib/learn/graph/probe';
import { nextMasteryCheck, probesFor, recordProbe } from '@/lib/learn/graph/session';
import { collectSpend, recordLearnSpend } from '@/lib/learn/spend';
import { answerQuestion, type AskState } from '../s/[id]/probe/actions';

/**
 * One question, asked without being asked which subject.
 *
 * Asking is its own action because the claim is picked across every subject
 * rather than inside one. Answering is the subject session's action called
 * through a wrapper, so the concept state, what a right answer settles
 * underneath it, and a repeated wrong answer becoming a named misconception
 * are the same code in both places rather than two versions that drift.
 */

export type TodayState = AskState & {
  /** The subject the picked claim belongs to. What the link onwards points at. */
  subjectId?: string;
  subjectName?: string;
  /** Set instead of a question when there is nothing to ask about. */
  nothing?: NothingToAsk;
};

// latency: pending
export async function askTodayQuestion(
  // Neither is read: nothing is carried over from a previous question, and
  // there is no subject or concept to name in the form. The two arguments are
  // what useActionState passes.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _prev: TodayState,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _formData: FormData,
): Promise<TodayState> {
  const user = await requireUser();

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: 'Asking a question needs ANTHROPIC_API_KEY to be set.' };

  const supabase = await createLearnClient();
  // Picked again here rather than carried from the page: what is ready can
  // have changed since the page was rendered, and the question should be
  // about what is ready now.
  const [subjects, rows] = await Promise.all([
    loadSubjects(supabase),
    loadReadyToLearn(supabase, 1),
  ]);

  const picked = pickOneToAsk(rows, subjects.length);
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
// latency: pending
export async function answerTodayQuestion(
  prev: TodayState,
  formData: FormData,
): Promise<TodayState> {
  return { ...prev, ...(await answerQuestion(prev, formData)) };
}
