'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createYouClient } from '@/lib/you/auth/server';
import {
  ANSWER_HREF,
  answerDashQuestion,
  editDashAnswer,
  skipDashQuestion,
  type DashQuestionResult,
} from '@/lib/you/dash-questions';

/**
 * The Answer tab's three presses (plan #2617.2): answer an open or skipped
 * question, skip an open one, change an answer already given. Each runs as the
 * person, on their client, and names their id as well.
 */

const NOT_A_QUESTION: DashQuestionResult = { ok: false, error: 'That is not one of your questions.' };

function isId(id: string): boolean {
  return z.string().uuid().safeParse(id).success;
}

async function run(
  write: (client: Awaited<ReturnType<typeof createYouClient>>, userId: string) => Promise<DashQuestionResult>,
): Promise<DashQuestionResult> {
  const user = await requireUser();
  try {
    const result = await write(await createYouClient(), user.id);
    if (result.ok) revalidatePath(ANSWER_HREF);
    return result;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'That did not save. Try again.' };
  }
}

/** Answer an open question, or a skipped one they came back to. */
// latency: pending
export async function answerQuestion(id: string, answer: string): Promise<DashQuestionResult> {
  if (!isId(id)) return NOT_A_QUESTION;
  return run((client, userId) => answerDashQuestion(client, userId, id, answer));
}

/** Skip an open question. It moves to the skipped list and can still be answered. */
// latency: pending
export async function skipQuestion(id: string): Promise<DashQuestionResult> {
  if (!isId(id)) return NOT_A_QUESTION;
  return run((client, userId) => skipDashQuestion(client, userId, id));
}

/** Change the answer to a question already answered. */
// latency: pending
export async function editAnswer(id: string, answer: string): Promise<DashQuestionResult> {
  if (!isId(id)) return NOT_A_QUESTION;
  return run((client, userId) => editDashAnswer(client, userId, id, answer));
}
