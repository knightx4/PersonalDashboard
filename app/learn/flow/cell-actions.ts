'use server';

import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { answerCell } from '@/lib/learn/levels/answer-store';
import { readAnswerSignals } from '@/lib/learn/confidence';
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
  // How sure they were and how they reasoned (plan #2522.3), kept on the
  // screen across an error and shown once graded (plan #2522.2).
  const howSure = readAnswerSignals(formData);
  if (!parsed.success) return { ...prev, howSure, error: 'Write an answer first.' };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ...prev, howSure, error: 'Grading needs ANTHROPIC_API_KEY to be set.' };

  const learn = await createLearnClient();
  const spend = collectSpend();
  const result = await answerCell(learn, user.id, {
    questionId: parsed.data.questionId,
    response: parsed.data.response,
    // How sure they were and how they reasoned (plan #2522.3); nulls from a form that does not ask yet.
    signals: howSure,
    anthropicApiKey: apiKey,
    onSpend: spend.sink,
  });
  await recordLearnSpend(user.id, 'grade-cell-answer', spend.reports);

  if (!result.ok) return { ...prev, error: result.error, response: parsed.data.response, howSure };
  return {
    moved: result.moved,
    error: null,
    response: parsed.data.response,
    howSure,
    ...(result.answer ? { answer: result.answer } : {}),
  };
}
