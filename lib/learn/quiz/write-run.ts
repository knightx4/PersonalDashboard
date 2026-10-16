import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { collectSpend, recordLearnSpend } from '@/lib/learn/spend';
import { enoughToAsk, writeQuizQuestions as writeFromMaterial } from './generate';
import { loadQuiz } from './load';
import { readQuizMaterial } from './material';
import { MIN_QUIZ_QUESTIONS } from './payload';
import { writeQuizQuestions as storeQuestions } from './save';

/**
 * Writing the questions a quiz asks: one press, several small calls, and one
 * insert at the end. The quiz page's button and Dash's write_quiz_questions
 * (lib/dash/paid-tools-learn.ts) both call this.
 *
 * The material is read at the moment this runs -- a note's body lives in the
 * vault and is never copied into the learn schema -- so a quiz written today
 * is written from what the notes say today. Nothing is stored unless enough
 * came back to be worth answering, and the sentence that comes back says
 * which material had nothing in it.
 */
export type QuizWriteResult =
  | { ok: true; quizId: string; title: string; written: number; message?: string }
  | { ok: false; error?: string; message?: string };

export async function writeQuizQuestionsFor(
  supabase: LearnSupabaseClient,
  userId: string,
  quizId: string,
): Promise<QuizWriteResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: 'Writing the questions needs ANTHROPIC_API_KEY to be set.' };

  const quiz = await loadQuiz(supabase, quizId);
  if (!quiz) return { ok: false, error: 'That quiz is gone.' };

  // Written once, up front. Asking again would replace the questions somebody
  // is part way through answering.
  if (quiz.questions.length > 0) return { ok: false, error: 'This quiz already has its questions.' };

  const material = await readQuizMaterial(quiz.sources);
  const sources = material
    .filter((piece) => piece.text !== null)
    .map((piece) => ({ id: piece.sourceId, title: piece.label, text: piece.text ?? '' }));

  if (sources.length === 0) {
    return { ok: false, error: 'None of the material this quiz is over can be read any more.' };
  }

  const spend = collectSpend();
  const written = await writeFromMaterial({
    sources,
    preparingFor: quiz.preparingFor,
    anthropicApiKey: apiKey,
    onSpend: spend.sink,
  });
  await recordLearnSpend(userId, 'write-quiz-questions', spend.reports);

  if (!enoughToAsk(written)) {
    const blank = [...written.empty, ...written.failed];
    return {
      ok: false,
      message: blank.length
        ? `There was not enough in that to ask ${MIN_QUIZ_QUESTIONS} questions about. Nothing answerable came out of ${blank.join(', ')}.`
        : `There was not enough in that to ask ${MIN_QUIZ_QUESTIONS} questions about.`,
    };
  }

  await storeQuestions(supabase, userId, quiz.id, written.questions);

  return {
    ok: true,
    quizId: quiz.id,
    title: quiz.title,
    written: written.questions.length,
    message: written.empty.length
      ? `${written.questions.length} questions. Nothing answerable came out of ${written.empty.join(', ')}.`
      : undefined,
  };
}
