'use server';

import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadQuiz } from '@/lib/learn/quiz/load';
import { readQuizMaterial } from '@/lib/learn/quiz/material';
import { gradeQuizAnswer } from '@/lib/learn/quiz/grade';
import { answerQuizQuestion, skipQuizQuestion } from '@/lib/learn/quiz/save';
import { outstandingCount } from '@/lib/learn/quiz/model';
import { collectSpend, recordLearnSpend } from '@/lib/learn/spend';

/**
 * Answering one question of a quiz, or passing on it.
 *
 * One action per question and nothing held between them. The questions were
 * written and stored before any of them was shown, so an answer only has to
 * name the row it is answering -- which is what makes a closed tab cost at
 * most the answer being typed.
 *
 * Neither action revalidates. What comes back is the mark and the answer that
 * was expected, and the screen has to be able to show it before the next
 * question replaces it; moving on is a press, and that is what refreshes.
 */

export type AnswerState = {
  error?: string;
  /** How it was marked, and what the material said. Shown before moving on. */
  verdict?: {
    outcome: 'right' | 'wrong' | 'skipped';
    expected: string;
    /** True when that was the last outstanding question. */
    finished: boolean;
  };
};

const AnswerInput = z.object({
  quizId: z.string().uuid(),
  questionId: z.string().uuid(),
  response: z.string().trim().min(1, 'Write something, or pass on it.').max(2000),
});

const SkipInput = z.object({
  quizId: z.string().uuid(),
  questionId: z.string().uuid(),
});

// latency: pending
export async function answerQuiz(_prev: AnswerState, formData: FormData): Promise<AnswerState> {
  const user = await requireUser();

  const parsed = AnswerInput.safeParse({
    quizId: formData.get('quizId') ?? '',
    questionId: formData.get('questionId') ?? '',
    response: formData.get('response') ?? '',
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Could not read that answer.' };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: 'Marking an answer needs ANTHROPIC_API_KEY to be set.' };

  const supabase = await createLearnClient();
  const quiz = await loadQuiz(supabase, parsed.data.quizId);
  const question = quiz?.questions.find((one) => one.id === parsed.data.questionId);
  if (!quiz || !question) return { error: 'Could not find the question that was being answered.' };

  // Already answered, on another tab or a double submit. Saying what it was
  // beats regrading it and overwriting what is there.
  if (question.outcome !== null) {
    return {
      verdict: {
        outcome: question.outcome,
        expected: question.expected,
        finished: outstandingCount(quiz) === 0,
      },
    };
  }

  const material = await readQuizMaterial(quiz.sources);
  const from = material.find((piece) => piece.sourceId === question.sourceId);

  const spend = collectSpend();
  const grade = await gradeQuizAnswer({
    source: from?.label ?? 'the material this quiz is over',
    question: question.question,
    expected: question.expected,
    response: parsed.data.response,
    anthropicApiKey: apiKey,
    onSpend: spend.sink,
  });
  await recordLearnSpend(user.id, 'grade-quiz-answer', spend.reports);

  if (!grade.ok) return { error: grade.detail };

  await answerQuizQuestion(supabase, question.id, {
    response: parsed.data.response,
    correct: grade.correct,
  });

  return {
    verdict: {
      outcome: grade.correct ? 'right' : 'wrong',
      expected: question.expected,
      finished: outstandingCount(quiz) === 1,
    },
  };
}

// latency: pending
export async function skipQuiz(_prev: AnswerState, formData: FormData): Promise<AnswerState> {
  await requireUser();

  const parsed = SkipInput.safeParse({
    quizId: formData.get('quizId') ?? '',
    questionId: formData.get('questionId') ?? '',
  });
  if (!parsed.success) return { error: 'Could not work out which question that was.' };

  const supabase = await createLearnClient();
  const quiz = await loadQuiz(supabase, parsed.data.quizId);
  const question = quiz?.questions.find((one) => one.id === parsed.data.questionId);
  if (!quiz || !question) return { error: 'Could not find the question that was being passed.' };

  const outstanding = outstandingCount(quiz);
  if (question.outcome === null) await skipQuizQuestion(supabase, question.id);

  return {
    verdict: {
      outcome: question.outcome ?? 'skipped',
      expected: question.expected,
      finished: question.outcome === null ? outstanding === 1 : outstanding === 0,
    },
  };
}
