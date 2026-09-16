import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/shell/page-header';
import { buttonVariants } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadQuiz } from '@/lib/learn/quiz/load';
import { outstandingCount, rightCount } from '@/lib/learn/quiz/model';
import { readQuizMaterial } from '@/lib/learn/quiz/material';
import { QUIZ_QUESTIONS } from '@/lib/learn/quiz/payload';
import { WriteQuestions } from './write-questions';

export const dynamic = 'force-dynamic';

/**
 * One quiz: what it was over, how it went, and every question with what you
 * wrote beside what the material expected.
 *
 * The same page whether the quiz has been answered or has not been started, so
 * there is one address for a quiz and no way to land on a stale copy of it.
 * What changes is what there is to say: material and a button before, the
 * marked questions afterwards.
 */

const MARK = {
  right: 'Right',
  wrong: 'Not quite',
  skipped: 'Passed',
} as const;

export default async function QuizPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createLearnClient();
  const quiz = await loadQuiz(supabase, id);
  if (!quiz) notFound();

  const material = await readQuizMaterial(quiz.sources);
  const from = new Map(material.map((piece) => [piece.sourceId, piece]));
  const left = outstandingCount(quiz);
  const right = rightCount(quiz);
  const answered = quiz.questions.filter((question) => question.outcome !== null).length;

  return (
    <>
      <p className="mb-3">
        <Link
          href="/learn/quiz"
          className="inline-flex items-center gap-1 text-ui text-ink-muted hover:text-ink"
        >
          <ArrowLeft className="size-3.5" strokeWidth={2} aria-hidden />
          Quizzes
        </Link>
      </p>

      <PageHeader
        title={quiz.title}
        description={
          answered > 0
            ? `${right} of ${answered} right${quiz.preparingFor ? `, for ${quiz.preparingFor}` : ''}.`
            : quiz.preparingFor
              ? `For ${quiz.preparingFor}.`
              : undefined
        }
      />

      <div className="max-w-2xl">
        <h2 className="mb-2 text-body font-semibold text-ink">What it is over</h2>

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

        {quiz.questions.length === 0 ? (
          <>
            <p className="mt-3 text-body text-ink-muted">
              No questions have been written for this yet. They are written once, from what the
              material says right now, and then they stay put.
            </p>
            <WriteQuestions quizId={quiz.id} count={QUIZ_QUESTIONS} />
          </>
        ) : (
          <>
            {left > 0 && (
              <p className="mt-4">
                <Link href={`/learn/quiz/${quiz.id}/take`} className={buttonVariants()}>
                  {left === quiz.questions.length ? 'Start the quiz' : `Carry on — ${left} left`}
                </Link>
              </p>
            )}

            {answered > 0 && (
              <>
                <h2 className="mb-2 mt-8 text-body font-semibold text-ink">How it went</h2>

                <ul className={cn(cardVariants(), 'divide-y divide-border overflow-hidden')}>
                  {quiz.questions
                    .filter((question) => question.outcome !== null)
                    .map((question) => (
                      <li key={question.id} className="px-4 py-3">
                        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                          <span className="min-w-0 flex-1 text-ui text-ink">
                            {question.question}
                          </span>
                          <span
                            className={cn(
                              'shrink-0 text-small font-medium',
                              question.outcome === 'right' ? 'text-positive' : 'text-ink-muted',
                            )}
                          >
                            {MARK[question.outcome!]}
                          </span>
                        </p>

                        <p className="mt-1.5 text-small text-ink-muted">What you wrote</p>
                        <p className="text-ui text-ink">
                          {question.response ?? 'Nothing — you passed on it.'}
                        </p>

                        <p className="mt-1.5 text-small text-ink-muted">What the material said</p>
                        <p className="text-ui text-ink">{question.expected}</p>

                        <p className="mt-1.5 text-small text-ink-ghost">
                          From {from.get(question.sourceId)?.label ?? 'material that is gone'}
                        </p>
                      </li>
                    ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}
