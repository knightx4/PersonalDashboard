'use server';

import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { answerCell } from '@/lib/learn/levels/answer-store';
import { collectSpend, recordLearnSpend } from '@/lib/learn/spend';
import type { CellAnswerState } from '@/components/learn/cell-answer-view';

/**
 * Answering an explain question about one level of a topic (plan #2138.5).
 * The grading and the writing are in lib/learn/levels/answer-store.ts; this
 * reads the form, records the call's cost and hands back what moved.
 */

const Answer = z.object({
  questionId: z.string().uuid(),
  response: z.string().trim().min(1).max(8_000),
});

// latency: pending
export async function answerCellQuestion(prev: CellAnswerState, formData: FormData): Promise<CellAnswerState> {
  const user = await requireUser();
  const parsed = Answer.safeParse({ questionId: formData.get('questionId'), response: formData.get('response') });
  if (!parsed.success) return { ...prev, error: 'Write an answer first.' };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ...prev, error: 'Grading needs ANTHROPIC_API_KEY to be set.' };

  const learn = await createLearnClient();
  const spend = collectSpend();
  const result = await answerCell(learn, user.id, {
    questionId: parsed.data.questionId,
    response: parsed.data.response,
    anthropicApiKey: apiKey,
    onSpend: spend.sink,
  });
  await recordLearnSpend(user.id, 'grade-cell-answer', spend.reports);

  if (!result.ok) return { ...prev, error: result.error, response: parsed.data.response };
  return { moved: result.moved, error: null, response: parsed.data.response };
}
