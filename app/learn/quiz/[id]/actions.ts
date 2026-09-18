'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadQuiz } from '@/lib/learn/quiz/load';
import { readQuizMaterial } from '@/lib/learn/quiz/material';
import { enoughToAsk, writeQuizQuestions as writeFromMaterial } from '@/lib/learn/quiz/generate';
import { writeQuizQuestions as storeQuestions } from '@/lib/learn/quiz/save';
import { MIN_QUIZ_QUESTIONS } from '@/lib/learn/quiz/payload';
import { collectSpend, recordLearnSpend } from '@/lib/learn/spend';

/**
 * Writing the questions a quiz asks.
 *
 * One press, several small calls, and one insert at the end. The material is
 * read at the moment this runs -- a note's body lives in the vault and is
 * never copied into the learn schema -- so a quiz written today is written
 * from what the notes say today.
 *
 * Nothing is stored unless enough came back to be worth answering. A quiz
 * holding two questions over three notes is a quiz that looks finished and is
 * not, and the sentence that comes back says which material had nothing in it.
 */

export type WriteQuestionsState = { error?: string; message?: string };

const Input = z.object({ quizId: z.string().uuid() });

// latency: pending
export async function writeQuestions(
  _prev: WriteQuestionsState,
  formData: FormData,
): Promise<WriteQuestionsState> {
  const user = await requireUser();

  const parsed = Input.safeParse({ quizId: formData.get('quizId') ?? '' });
  if (!parsed.success) return { error: 'Could not read which quiz that was.' };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: 'Writing the questions needs ANTHROPIC_API_KEY to be set.' };

  const supabase = await createLearnClient();
  const quiz = await loadQuiz(supabase, parsed.data.quizId);
  if (!quiz) return { error: 'That quiz is gone.' };

  // Written once, up front. Asking again would replace the questions somebody
  // is part way through answering.
  if (quiz.questions.length > 0) return { error: 'This quiz already has its questions.' };

  const material = await readQuizMaterial(quiz.sources);
  const sources = material
    .filter((piece) => piece.text !== null)
    .map((piece) => ({ id: piece.sourceId, title: piece.label, text: piece.text ?? '' }));

  if (sources.length === 0) {
    return { error: 'None of the material this quiz is over can be read any more.' };
  }

  const spend = collectSpend();
  const written = await writeFromMaterial({
    sources,
    preparingFor: quiz.preparingFor,
    anthropicApiKey: apiKey,
    onSpend: spend.sink,
  });
  await recordLearnSpend(user.id, 'write-quiz-questions', spend.reports);

  if (!enoughToAsk(written)) {
    const blank = [...written.empty, ...written.failed];
    return {
      message: blank.length
        ? `There was not enough in that to ask ${MIN_QUIZ_QUESTIONS} questions about. Nothing answerable came out of ${blank.join(', ')}.`
        : `There was not enough in that to ask ${MIN_QUIZ_QUESTIONS} questions about.`,
    };
  }

  await storeQuestions(supabase, user.id, quiz.id, written.questions);

  revalidatePath(`/learn/quiz/${quiz.id}`);

  return {
    message: written.empty.length
      ? `${written.questions.length} questions. Nothing answerable came out of ${written.empty.join(', ')}.`
      : undefined,
  };
}
