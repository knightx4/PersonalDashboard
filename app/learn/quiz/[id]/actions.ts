'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { writeQuizQuestionsFor } from '@/lib/learn/quiz/write-run';

/**
 * Writing the questions a quiz asks (writeQuizQuestionsFor). Nothing is
 * stored unless enough came back to be worth answering. A quiz holding two
 * questions over three notes is a quiz that looks finished and is not, and
 * the sentence that comes back says which material had nothing in it.
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

  const result = await writeQuizQuestionsFor(await createLearnClient(), user.id, parsed.data.quizId);
  if (!result.ok) return result.error ? { error: result.error } : { message: result.message };

  revalidatePath(`/learn/quiz/${result.quizId}`);
  return { message: result.message };
}
