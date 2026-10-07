import { notFound } from 'next/navigation';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadQuiz } from '@/lib/learn/quiz/load';
import { readQuizMaterial } from '@/lib/learn/quiz/material';
import { QuizView } from './quiz-view';

export const dynamic = 'force-dynamic';

/** One quiz; quiz-view.tsx draws it. */
export default async function QuizPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createLearnClient();
  const quiz = await loadQuiz(supabase, id);
  if (!quiz) notFound();

  const material = await readQuizMaterial(quiz.sources);
  return <QuizView quiz={quiz} material={material} />;
}
