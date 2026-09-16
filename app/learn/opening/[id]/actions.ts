'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import {
  answerOpeningQuestion,
  loadSweep,
  skipOpeningQuestion,
} from '@/lib/learn/graph/opening';
import { gradeOpeningAnswer } from '@/lib/learn/graph/opening-probe';
import { collectSpend, recordLearnSpend } from '@/lib/learn/spend';

/**
 * Answering one of the ten opening questions, or passing on it.
 *
 * One action per question and no session object between them. The questions
 * were written and stored before any of them was shown, so an answer only has
 * to name the row it is answering -- which is what makes a closed tab cost
 * nothing and the count on the screen a fact about the rows.
 *
 * Nothing here touches the graph. A sweep runs before any subject exists, and
 * what the answers do to a concept happens on approval, much later.
 */

export type AnswerState = { error?: string };

const AnswerInput = z.object({
  sweepId: z.string().uuid(),
  questionId: z.string().uuid(),
  response: z.string().trim().min(1, 'Write something, or pass on it.').max(2000),
});

const SkipInput = z.object({
  sweepId: z.string().uuid(),
  questionId: z.string().uuid(),
});

// latency: pending
export async function answerOpening(
  _prev: AnswerState,
  formData: FormData,
): Promise<AnswerState> {
  const user = await requireUser();

  const parsed = AnswerInput.safeParse({
    sweepId: formData.get('sweepId') ?? '',
    questionId: formData.get('questionId') ?? '',
    response: formData.get('response') ?? '',
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Could not read that answer.' };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: 'Grading an answer needs ANTHROPIC_API_KEY to be set.' };

  const supabase = await createLearnClient();
  const sweep = await loadSweep(supabase, parsed.data.sweepId);
  const question = sweep?.questions.find((q) => q.id === parsed.data.questionId);
  if (!question) return { error: 'Could not find the question that was being answered.' };

  // Already reached, on another tab or a double submit. Saying so beats
  // regrading it and overwriting what is there.
  if (question.outcome !== null) return {};

  const spend = collectSpend();
  const grade = await gradeOpeningAnswer({
    claim: { name: question.claimName, claim: question.claim },
    question: question.question,
    expected: question.expected,
    response: parsed.data.response,
    anthropicApiKey: apiKey,
    onSpend: spend.sink,
  });
  await recordLearnSpend(user.id, 'grade-opening-answer', spend.reports);

  if (!grade.ok) return { error: grade.detail };

  await answerOpeningQuestion(supabase, question.id, {
    response: parsed.data.response,
    correct: grade.correct,
  });

  revalidatePath(`/learn/opening/${parsed.data.sweepId}`);
  return {};
}

// latency: optimistic
//
// One row write and a revalidate, with no model call in it -- unlike
// answerOpening above, which is `pending` because it waits on a grade. Nothing
// here can come back with a different answer than the one the card already
// showed, so the question can close the moment it is skipped.
export async function skipOpening(_prev: AnswerState, formData: FormData): Promise<AnswerState> {
  await requireUser();

  const parsed = SkipInput.safeParse({
    sweepId: formData.get('sweepId') ?? '',
    questionId: formData.get('questionId') ?? '',
  });
  if (!parsed.success) return { error: 'Could not work out which question that was.' };

  const supabase = await createLearnClient();
  await skipOpeningQuestion(supabase, parsed.data.questionId);

  revalidatePath(`/learn/opening/${parsed.data.sweepId}`);
  return {};
}
