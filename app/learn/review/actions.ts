'use server';

import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { toReviewQuestion, type ReviewQuestion, type ReviewQuestionRow } from '@/lib/learn/lessons/review';
import {
  loadAskedReviews,
  loadReviewTarget,
  recordReview,
  REVIEW_QUESTION_COLUMNS,
} from '@/lib/learn/lessons/review-store';
import { markReviewQuestion, REVIEW_MODEL, writeReviewQuestion } from '@/lib/learn/lessons/write-review';
import { collectSpend, recordLearnSpend } from '@/lib/learn/spend';

/**
 * The presses on a review question (plan #1145), from Learn now and from the
 * top of a piece's page. Ask me writes one question on the idea and stores it
 * before it is shown; Check my answer marks it and moves the idea along the
 * schedule. Both go through the person's own session.
 */

const Id = z.string().uuid();
const AnswerText = z.string().trim().min(1).max(2000);

export type AskReviewResult = { error?: string; question?: ReviewQuestion };

/**
 * Ask me. Haiku writes one question on the idea from its claim, told the
 * questions already asked on it. An unanswered question already there is
 * shown again rather than paying for another.
 */
// latency: pending
export async function askReview(conceptId: string): Promise<AskReviewResult> {
  const user = await requireUser();
  const id = Id.safeParse(conceptId);
  if (!id.success) return { error: 'Could not tell which idea that was.' };
  const learn = await createLearnClient();

  try {
    const { data: open, error: openError } = await learn
      .from('review_questions')
      .select(REVIEW_QUESTION_COLUMNS)
      .eq('user_id', user.id)
      .eq('concept_id', id.data)
      .is('response', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (openError) return { error: `Reading the question failed: ${openError.message}` };
    if (open) return { question: toReviewQuestion(open as ReviewQuestionRow) };

    const target = await loadReviewTarget(learn, user.id, id.data);
    if (!target) return { error: 'This idea is not due for review.' };

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return { error: 'Writing a question needs ANTHROPIC_API_KEY to be set.' };

    const asked = await loadAskedReviews(learn, user.id, id.data);
    const spend = collectSpend();
    let written = await writeReviewQuestion({ idea: target.idea, asked, anthropicApiKey: apiKey, onSpend: spend.sink });
    // A question that gave its answer away or asked for a term is thrown out;
    // one more try usually lands.
    if (written.outcome === 'dropped') {
      written = await writeReviewQuestion({ idea: target.idea, asked, anthropicApiKey: apiKey, onSpend: spend.sink });
    }
    await recordLearnSpend(user.id, 'write-review-question', spend.reports);
    if (written.outcome === 'failed') return { error: `Writing the question failed: ${written.detail}` };
    if (written.outcome === 'dropped') return { error: 'Dash could not write a fair question this time. Try again.' };

    const { data: row, error } = await learn
      .from('review_questions')
      .insert({
        user_id: user.id,
        concept_id: id.data,
        question: written.question,
        expected: written.expected,
        write_model: REVIEW_MODEL,
      })
      .select(REVIEW_QUESTION_COLUMNS)
      .single();
    if (error) return { error: `Saving the question failed: ${error.message}` };
    return { question: toReviewQuestion(row as ReviewQuestionRow) };
  } catch (caught) {
    return { error: caught instanceof Error ? caught.message : 'Could not write a question.' };
  }
}

export type AnswerReviewResult = {
  error?: string;
  question?: ReviewQuestion;
  /** Days until the idea's next question, once the answer is marked. */
  nextInDays?: number;
};

/**
 * Check my answer. Haiku marks what was written against the answer expected.
 * A right answer moves the idea's next question further out and a miss
 * brings it back tomorrow (`nextInterval`).
 */
// latency: pending
export async function answerReview(questionId: string, response: string): Promise<AnswerReviewResult> {
  const user = await requireUser();
  const id = Id.safeParse(questionId);
  if (!id.success) return { error: 'Could not tell which question that was.' };
  const answer = AnswerText.safeParse(response);
  if (!answer.success) return { error: 'Write an answer first, in a sentence or two.' };
  const learn = await createLearnClient();

  try {
    const { data, error } = await learn
      .from('review_questions')
      .select(REVIEW_QUESTION_COLUMNS)
      .eq('id', id.data)
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) return { error: `Reading the question failed: ${error.message}` };
    const row = data as ReviewQuestionRow | null;
    if (!row) return { error: 'That question is no longer there.' };
    // Answered already, in another tab: show that mark rather than paying for another.
    if (row.correct !== null) return { question: toReviewQuestion(row) };

    const target = await loadReviewTarget(learn, user.id, row.concept_id);
    if (!target) return { error: 'This idea is no longer on the review schedule.' };

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return { error: 'Marking an answer needs ANTHROPIC_API_KEY to be set.' };

    const spend = collectSpend();
    const grade = await markReviewQuestion({
      idea: target.idea,
      question: row.question,
      expected: row.expected,
      response: answer.data,
      anthropicApiKey: apiKey,
      onSpend: spend.sink,
    });
    await recordLearnSpend(user.id, 'mark-review-question', spend.reports);
    if (!grade.ok) return { error: `Marking failed: ${grade.detail}` };

    const { data: marked, error: markError } = await learn
      .from('review_questions')
      .update({
        response: answer.data,
        correct: grade.correct,
        marked_why: grade.why,
        answered_at: new Date().toISOString(),
      })
      .eq('id', id.data)
      .eq('user_id', user.id)
      .is('response', null)
      .select(REVIEW_QUESTION_COLUMNS);
    if (markError) return { error: `Recording the answer failed: ${markError.message}` };
    // Another press got there first and recorded its own mark.
    const saved = (marked ?? [])[0] as ReviewQuestionRow | undefined;
    if (!saved) return { error: 'That question has been answered already.' };

    const nextInDays = await recordReview(learn, user.id, row.concept_id, target, grade.correct);
    return { question: toReviewQuestion(saved), nextInDays };
  } catch (caught) {
    return { error: caught instanceof Error ? caught.message : 'Could not mark that.' };
  }
}
