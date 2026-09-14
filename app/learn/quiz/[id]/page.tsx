import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/shell/page-header';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadQuiz } from '@/lib/learn/quiz/load';
import { readQuizMaterial } from '@/lib/learn/quiz/material';
import { QUIZ_QUESTIONS } from '@/lib/learn/quiz/payload';
import { WriteQuestions } from './write-questions';

export const dynamic = 'force-dynamic';

/**
 * One quiz: what it is over, and how far through it you are.
 *
 * A quiz with no questions yet is the row the picking screen ends on, so this
 * page has to render one — the material is already a real thing to look at,
 * and nothing has been asked of a model.
 */
export default async function QuizPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createLearnClient();
  const quiz = await loadQuiz(supabase, id);
  if (!quiz) notFound();

  const material = await readQuizMaterial(quiz.sources);

  return (
    <>
      <PageHeader
        title={quiz.title}
        description={
          quiz.preparingFor
            ? `For ${quiz.preparingFor}. ${quiz.questions.length} questions.`
            : `${quiz.questions.length} questions.`
        }
      />

      <div className="max-w-2xl">
        <h2 className="mb-2 text-lead font-semibold text-ink">What it is over</h2>

        <ul className={cn(cardVariants(), 'divide-y divide-border overflow-hidden')}>
          {material.map((piece) => (
            <li key={piece.sourceId} className="flex items-baseline gap-2.5 px-4 py-3">
              <span className="min-w-0 flex-1 text-ui text-ink">
                {piece.href ? (
                  <Link href={piece.href} className="hover:text-accent">
                    {piece.label}
                  </Link>
                ) : (
                  piece.label
                )}
              </span>
              <span className="shrink-0 text-small text-ink-muted">
                {piece.href ? 'Note' : piece.text === null ? 'Gone' : 'Pasted'}
              </span>
            </li>
          ))}
        </ul>

        {quiz.questions.length === 0 && (
          <>
            <p className="mt-3 text-body text-ink-muted">
              No questions have been written for this yet. They are written once, from what the
              material says right now, and then they stay put.
            </p>
            <WriteQuestions quizId={quiz.id} count={QUIZ_QUESTIONS} />
          </>
        )}
      </div>
    </>
  );
}
