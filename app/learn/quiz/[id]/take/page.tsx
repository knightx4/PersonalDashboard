import { notFound, redirect } from 'next/navigation';
import { PageHeader } from '@/components/shell/page-header';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadQuiz } from '@/lib/learn/quiz/load';
import { nextQuestion, outstandingCount } from '@/lib/learn/quiz/model';
import { QuestionForm } from './question-form';

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

  const total = quiz.questions.length;
  const left = outstandingCount(quiz);

  return (
    <>
      <PageHeader
        title={quiz.title}
        description={
          quiz.preparingFor
            ? `For ${quiz.preparingFor}. Answer in your own words — a phrase or a sentence is enough.`
            : 'Answer in your own words — a phrase or a sentence is enough.'
        }
      />

      <div className="max-w-2xl">
        <QuestionForm
          key={current.id}
          quizId={quiz.id}
          questionId={current.id}
          question={current.question}
          position={total - left + 1}
          total={total}
          left={left}
        />
      </div>
    </>
  );
}
