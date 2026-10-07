import { notFound, redirect } from 'next/navigation';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadQuiz } from '@/lib/learn/quiz/load';
import { nextQuestion } from '@/lib/learn/quiz/model';
import { TakeQuizView } from './take-view';

export const dynamic = 'force-dynamic';

/**
 * Working through a quiz, one question at a time.
 *
 * Which question you are on is read back from the rows rather than carried
 * anywhere, so closing the tab costs at most the answer being typed and
 * reloading puts you back where you were.
 *
 * A quiz with nothing outstanding has nowhere to go but its result, and a quiz
 * with no questions yet has nothing to ask, so both send you back to the quiz.
 */
export default async function TakeQuizPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createLearnClient();
  const quiz = await loadQuiz(supabase, id);
  if (!quiz) notFound();

  const current = nextQuestion(quiz);
  if (!current) redirect(`/learn/quiz/${quiz.id}`);

  return <TakeQuizView quiz={quiz} current={current} />;
}
