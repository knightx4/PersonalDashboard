import Link from 'next/link';
import { PageHeader } from '@/components/shell/page-header';
import { buttonVariants } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadQuizzes, type QuizListItem } from '@/lib/learn/quiz/load';

export const dynamic = 'force-dynamic';

/**
 * The quizzes you have taken, and the ones you have not finished.
 *
 * Unfinished first, because a half-done quiz is the only row on this page
 * anybody needs to act on. Everything else is a record: what it was over, how
 * many you got, and when.
 */

function when(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** What a row says about how it went, in one phrase. */
function standing(quiz: QuizListItem): string {
  if (quiz.total === 0) return 'No questions yet';
  if (quiz.left > 0) return `${quiz.left} of ${quiz.total} left`;
  return `${quiz.right} of ${quiz.total} right`;
}

export default async function QuizzesPage() {
  const supabase = await createLearnClient();
  const quizzes = await loadQuizzes(supabase);

  return (
    <>
      <PageHeader
        title="Quizzes"
        description="Questions written from notes you chose, answered in your own words."
        actions={
          <Link href="/learn/quiz/new" className={buttonVariants()}>
            New quiz
          </Link>
        }
      />

      {quizzes.length === 0 ? (
        <p className="text-body text-ink-muted">
          Nothing yet. Pick a few notes and a quiz gets written from what they say.
        </p>
      ) : (
        <ul className={cn(cardVariants(), 'max-w-2xl divide-y divide-border overflow-hidden')}>
          {quizzes.map((quiz) => (
            <li key={quiz.id}>
              <Link
                href={quiz.left > 0 && quiz.total > 0 ? `/learn/quiz/${quiz.id}/take` : `/learn/quiz/${quiz.id}`}
                className="flex items-baseline gap-2.5 px-4 py-3 transition-colors hover:bg-sunken"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ui text-ink">{quiz.title}</span>
                  {quiz.preparingFor && quiz.preparingFor !== quiz.title && (
                    <span className="block truncate text-small text-ink-muted">
                      For {quiz.preparingFor}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-small text-ink-muted">{standing(quiz)}</span>
                <span className="shrink-0 text-small text-ink-ghost">{when(quiz.createdAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
