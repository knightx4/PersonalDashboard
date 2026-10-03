import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { SectionFold } from '@/components/ui/disclosure';
import { cn } from '@/lib/cn';
import type { QuizListItem } from '@/lib/learn/quiz/load';

/**
 * The quizzes you have taken, and the ones you have not finished, as a
 * section of Subjects (plan #1487). They were a tab of their own until then;
 * /learn/quiz now redirects here with `?open=quizzes`, which opens the fold.
 *
 * Unfinished first, because a half-done quiz is the only row here anybody
 * needs to act on. Everything else is a record: what it was over, how many
 * you got, and when. The fold opens by itself while one is unfinished.
 */

/** Where the old Quizzes tab, and a quiz's back link, now land. */
export const QUIZZES_HREF = '/learn/know?open=quizzes#quizzes';

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

export function QuizzesSection({
  quizzes,
  failed,
  open,
}: {
  quizzes: QuizListItem[];
  failed: boolean;
  open: boolean;
}) {
  const unfinished = quizzes.some((quiz) => quiz.total > 0 && quiz.left > 0);

  return (
    <div id="quizzes" className="mt-8 scroll-mt-6">
      <SectionFold
        title="Quizzes"
        count={quizzes.length > 0 ? quizzes.length : undefined}
        defaultOpen={open || unfinished}
      >
        <p className="text-ui text-ink-muted">
          Questions written from notes you chose, answered in your own words.
        </p>

        {failed ? (
          <p className="text-ui text-ink-muted">The quizzes could not be read.</p>
        ) : quizzes.length === 0 ? (
          <p className="text-ui text-ink-muted">
            Nothing yet. Pick a few notes and a quiz gets written from what they say.
          </p>
        ) : (
          <ul className={cn(cardVariants(), 'max-w-2xl divide-y divide-border overflow-hidden')}>
            {quizzes.map((quiz) => (
              <li key={quiz.id}>
                <Link
                  href={
                    quiz.left > 0 && quiz.total > 0 ? `/learn/quiz/${quiz.id}/take` : `/learn/quiz/${quiz.id}`
                  }
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

        <Link href="/learn/quiz/new" className={buttonVariants({ variant: 'secondary' })}>
          New quiz
        </Link>
      </SectionFold>
    </div>
  );
}
